/**
 * Thin Apify wrapper for Bank of Israel Exchange Rates (שער יציג) & ILS Converter.
 *
 * All business logic lives in src/lib/*.ts (pure functions, no Apify imports, unit tested). This
 * file: reads input, decides live vs fixture data, loads the source series, and pushes one dataset
 * row per answer - charging one `rate-row` event per row that carries a rate - never letting one
 * bad entry kill the run, and failing loudly (never exiting 0 with missing data) when the Bank of
 * Israel source is unreachable or has changed its format.
 */
import { Actor, log } from 'apify';
import { createBoiHttpSource, DEFAULT_ADAPTER_CONFIG, type RateSource } from './lib/boi-adapter.js';
import { emitRows } from './lib/emit.js';
import { DEFAULT_HTTP_POLICY } from './lib/http.js';
import { InputError, normalizeInput, resolveDataSource } from './lib/input.js';
import { prepareRun, rowsOf } from './lib/run.js';
import { describeCharging, PPE_EVENTS, pushResultsAndCharge, remainingChargeable } from './lib/ppe.js';
import { addToSummary, emptySummary, type ResultRow } from './lib/process.js';
import { createFixtureFetch } from './fixture-fetch.js';

const BATCH_SIZE = 50;

/**
 * VERIFY(BOI-01, BOI-04): the endpoints can be overridden without a rebuild (Actor environment
 * variables) so the live check can point at the correct location before the code is corrected.
 */
function adapterConfig(): typeof DEFAULT_ADAPTER_CONFIG {
  return {
    publicApiBase: process.env.BOI_PUBLICAPI_BASE_URL?.trim() || DEFAULT_ADAPTER_CONFIG.publicApiBase,
    sdmxDataUrl: process.env.BOI_SDMX_DATA_URL?.trim() || DEFAULT_ADAPTER_CONFIG.sdmxDataUrl,
  };
}

function liveSource(): RateSource {
  return createBoiHttpSource({
    config: adapterConfig(),
    policy: DEFAULT_HTTP_POLICY,
    deps: {
      fetch: (url, init) => fetch(url, init),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      random: Math.random,
    },
  });
}

function fixtureSource(): RateSource {
  return createBoiHttpSource({
    deps: { fetch: createFixtureFetch(), sleep: () => Promise.resolve(), random: () => 0 },
  });
}

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput());
  const decision = resolveDataSource({
    inputValue: input.dataSource,
    envValue: process.env.BOI_DATA_SOURCE,
    isAtHome: Actor.isAtHome(),
  });
  log.info(describeCharging());
  log.info(`Data source: ${decision.source} (${decision.reason}).`);
  if (decision.source === 'fixtures') {
    log.warning(
      'FIXTURE MODE: rows are computed from SYNTHETIC test data bundled with the repository, NOT from the Bank of Israel. ' +
        'They are labelled dataSource="fixtures". This mode is refused on the Apify platform.',
    );
  }

  const now = new Date();
  const source = decision.source === 'live' ? liveSource() : fixtureSource();
  const prepared = await prepareRun(input, now, source, decision.source);
  const { plan, loaded } = prepared;
  for (const warning of plan.warnings) log.warning(warning);
  log.info(
    `Plan: ${plan.entries.length} row(s) to answer (${plan.totalRequested} requested), ${plan.windows.length} source window(s) for ${plan.currencies.length} currenc${plan.currencies.length === 1 ? 'y' : 'ies'}, rule "${plan.rateRule}".`,
  );
  for (const warning of new Set(loaded.warnings)) log.warning(warning);
  for (const [currency, failure] of loaded.failures) log.error(`${currency}: ${failure.code}: ${failure.message}`);

  const summary = emptySummary(plan, decision.source);
  summary.sourceRequests = loaded.requests;
  summary.warnings.push(...new Set(loaded.warnings));
  summary.sourceFailures = [...loaded.failures].map(([currency, f]) => ({ currency, code: f.code, message: f.message }));

  const rows = rowsOf(prepared);

  const emitted = await emitRows<ResultRow>(
    rows,
    {
      remainingPaid: () => remainingChargeable(PPE_EVENTS.RATE_ROW),
      pushPaid: (batch) => pushResultsAndCharge(batch as unknown as Record<string, unknown>[], PPE_EVENTS.RATE_ROW),
      pushFree: async (batch) => {
        try {
          await Actor.pushData(batch as unknown as Record<string, unknown>[]);
          return { ok: true };
        } catch (err) {
          log.error(`Could not save ${batch.length} notice row(s): ${err instanceof Error ? err.message : String(err)}`);
          return { ok: false };
        }
      },
      onSaved: (saved) => {
        for (const row of saved) addToSummary(summary, row);
      },
    },
    BATCH_SIZE,
  );
  const skipped = prepared.context.stats.skippedNoPublication;
  summary.skippedNoPublication = skipped;
  summary.stoppedForBudget = emitted.stoppedForBudget;
  if (emitted.stoppedForBudget) log.warning('Your maximum charge per run (maxTotalChargeUsd) is reached; stopped early.');
  if (skipped > 0) log.info(`${skipped} requested date(s) had no publication of their own and were skipped (rateRule "same-day").`);

  await Actor.setValue('SUMMARY', summary);

  const sourceProblems = loaded.failures.size;
  const message =
    `${summary.okRows} rate row${summary.okRows === 1 ? '' : 's'} delivered` +
    (summary.problemRows > 0 ? `, ${summary.problemRows} notice row${summary.problemRows === 1 ? '' : 's'} (free)` : '') +
    (decision.source === 'fixtures' ? ' [FIXTURE MODE: synthetic data, not Bank of Israel rates]' : '') +
    (emitted.stoppedForBudget ? `; stopped at your maximum charge (${emitted.notDelivered} row(s) not delivered)` : '') +
    '.';
  log.info(message);

  if (emitted.unsaved > 0) {
    await Actor.fail(`${emitted.unsaved} result row(s) could not be saved to the dataset; see the log.`);
  } else if (sourceProblems > 0) {
    const first = [...loaded.failures.values()][0];
    await Actor.fail(
      `The Bank of Israel source failed for ${sourceProblems} of ${plan.currencies.length} currenc${plan.currencies.length === 1 ? 'y' : 'ies'}: ${first?.message ?? 'unknown error'} ` +
        'Rows that could be answered were saved (SOURCE_* notice rows list the rest); nothing was charged for the failed ones. Try again later.',
    );
  } else {
    await Actor.exit({ statusMessage: message });
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await Actor.fail(err instanceof InputError ? `Invalid input: ${message}` : `Actor run failed: ${message}`);
}
