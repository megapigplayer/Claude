/**
 * Thin Apify wrapper for the Israeli ID, Company Number, IBAN & Phone Validator.
 *
 * All business logic lives in src/lib/*.ts (pure functions, no Apify imports, unit tested).
 * This file: reads input, checks the values in batches, pushes one dataset row per value and charges one
 * `value-checked` event per row, and never lets one bad entry kill the run.
 *
 * Privacy: the values are personal data (ID numbers, phone numbers, accounts). Nothing is sent anywhere and the
 * log only ever contains counts, never a value.
 */
import { Actor, log } from 'apify';
import { collectRecords, InputError, normalizeInput } from './lib/input.js';
import { describeCharging, PPE_EVENTS, pushResultsAndCharge, remainingChargeable } from './lib/ppe.js';
import { addToSummary, emptySummary, isChargeable, type ResultRow, safeBuildRow } from './lib/process.js';

const BATCH_SIZE = 100;

/** Rows lost to an internal error are saved but never billed. */
async function pushUnbilled(rows: ResultRow[]): Promise<boolean> {
  try {
    await Actor.pushData(rows as unknown as Record<string, unknown>[]);
    return true;
  } catch (err) {
    log.error(`Could not save ${rows.length} unbilled row(s): ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput());
  log.info(describeCharging());

  const collected = collectRecords(input.values);
  const records = collected.records.slice(0, input.maxItems);
  const summary = emptySummary();
  summary.skippedBlank = collected.skippedBlank;
  summary.skippedUnsupported = collected.skippedUnsupported;
  summary.truncatedByMaxItems = collected.records.length - records.length;
  if (summary.truncatedByMaxItems > 0) {
    log.warning(`Input has ${collected.records.length} values; only the first ${records.length} are checked (maxItems).`);
  }
  if (summary.skippedBlank + summary.skippedUnsupported > 0) {
    log.info(
      `Skipped ${summary.skippedBlank} blank and ${summary.skippedUnsupported} unsupported entr${summary.skippedBlank + summary.skippedUnsupported === 1 ? 'y' : 'ies'} (not checked, not charged).`,
    );
  }

  const options = { type: input.type, rejectDummy: input.rejectDummy, normalize: input.normalize };
  let processed = 0;
  let unsaved = 0;

  while (processed < records.length) {
    // Never check values nobody will be charged for: size the batch to the remaining budget.
    const remaining = remainingChargeable(PPE_EVENTS.VALUE_CHECKED);
    if (remaining <= 0) {
      summary.stoppedForBudget = true;
      break;
    }
    const batch = records.slice(processed, processed + Math.min(BATCH_SIZE, remaining));
    processed += batch.length;

    // safeBuildRow turns an unexpected exception into one INTERNAL_ERROR row.
    const rows = batch.map((record) => safeBuildRow(record, options));
    const billed = rows.filter(isChargeable);
    const unbilled = rows.filter((row) => !isChargeable(row));

    const outcome = await pushResultsAndCharge(billed as unknown as Record<string, unknown>[], PPE_EVENTS.VALUE_CHECKED);
    if (!outcome.ok) {
      unsaved += billed.length;
    } else {
      // In PPE runs the SDK saves only the rows that fit in maxTotalChargeUsd (pushedCount).
      for (const row of billed.slice(0, outcome.pushedCount)) addToSummary(summary, row);
    }
    if (unbilled.length > 0) {
      if (await pushUnbilled(unbilled)) for (const row of unbilled) addToSummary(summary, row);
      else unsaved += unbilled.length;
    }
    if (outcome.ok && outcome.pushedCount < billed.length) {
      summary.stoppedForBudget = true;
      break;
    }
  }
  if (summary.stoppedForBudget) log.warning('Your maximum charge per run (maxTotalChargeUsd) is reached; stopped early.');

  await Actor.setValue('SUMMARY', summary);
  const notChecked = records.length - summary.total - unsaved;
  const message =
    `Checked ${summary.total} value${summary.total === 1 ? '' : 's'}: ${summary.valid} valid, ${summary.invalid} invalid` +
    (summary.stoppedForBudget ? ` (stopped at your maximum charge; ${notChecked} not checked)` : '') +
    '.';
  log.info(message);

  if (unsaved > 0) {
    // Infrastructure problem (dataset push failed): fail loudly instead of returning less data silently.
    await Actor.fail(`${unsaved} result row(s) could not be saved to the dataset; see the log.`);
  } else {
    await Actor.exit({ statusMessage: message });
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await Actor.fail(err instanceof InputError ? `Invalid input: ${message}` : `Actor run failed: ${message}`);
}
