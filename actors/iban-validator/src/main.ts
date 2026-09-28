/**
 * Thin Apify wrapper for the IBAN Validator & Normalizer.
 *
 * All business logic lives in src/lib/*.ts (pure functions, no Apify imports, unit tested).
 * This file: reads input, validates the records in batches, pushes one dataset row per IBAN and
 * charges one `iban-validated` event per row, and never lets one bad entry kill the run.
 */
import { Actor, log } from 'apify';
import { collectRecords, InputError, normalizeInput } from './lib/input.js';
import { describeCharging, PPE_EVENTS, pushResultsAndCharge, remainingChargeable } from './lib/ppe.js';
import { addToSummary, emptySummary, safeBuildRow } from './lib/process.js';

const BATCH_SIZE = 100;

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput());
  log.info(describeCharging());

  const collected = collectRecords(input);
  const records = collected.records.slice(0, input.maxItems);
  const summary = emptySummary();
  summary.skippedBlank = collected.skippedBlank;
  summary.truncatedByMaxItems = collected.records.length - records.length;
  if (summary.truncatedByMaxItems > 0) {
    log.warning(`Input has ${collected.records.length} IBANs; only the first ${records.length} are validated (maxItems).`);
  }
  if (summary.skippedBlank > 0) {
    log.info(`Skipped ${summary.skippedBlank} blank entr${summary.skippedBlank === 1 ? 'y' : 'ies'} (not validated, not charged).`);
  }
  if (collected.csvHeaderDetected) log.info('CSV header row detected; using its "iban" (and "bic"/"swift") columns.');

  let processed = 0;
  let unsaved = 0;

  while (processed < records.length) {
    // Never validate rows nobody will be charged for: size the batch to the remaining budget.
    const remaining = remainingChargeable(PPE_EVENTS.IBAN_VALIDATED);
    if (remaining <= 0) {
      summary.stoppedForBudget = true;
      break;
    }
    const batch = records.slice(processed, processed + Math.min(BATCH_SIZE, remaining));

    // safeBuildRow turns an unexpected exception into one INTERNAL_ERROR row.
    const rows = batch.map((record) => safeBuildRow(record));
    const outcome = await pushResultsAndCharge(rows as unknown as Record<string, unknown>[], PPE_EVENTS.IBAN_VALIDATED);
    if (!outcome.ok) {
      unsaved += rows.length;
      processed += batch.length;
      continue;
    }
    // In PPE runs the SDK saves only the rows that fit in maxTotalChargeUsd (pushedCount).
    for (const row of rows.slice(0, outcome.pushedCount)) addToSummary(summary, row);
    processed += outcome.pushedCount;
    if (outcome.pushedCount < rows.length) {
      summary.stoppedForBudget = true;
      break;
    }
  }
  if (summary.stoppedForBudget) log.warning('Your maximum charge per run (maxTotalChargeUsd) is reached; stopped early.');

  await Actor.setValue('SUMMARY', summary);
  const message =
    `Validated ${summary.total} IBAN${summary.total === 1 ? '' : 's'}: ${summary.valid} valid, ${summary.invalid} invalid` +
    (summary.stoppedForBudget ? ` (stopped at your maximum charge; ${records.length - processed} not checked)` : '') +
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
