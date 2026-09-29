/**
 * Thin Apify wrapper for the Hebrew Date Converter.
 *
 * All business logic lives in src/lib/*.ts (pure functions, unit tested; only ppe.ts imports the
 * Apify SDK). This file: reads input, converts the entries in batches, pushes one dataset row per
 * entry (in input order, error rows included) and charges one `date-converted` event per row that was
 * converted successfully. Unreadable, blank and failed entries are visible in the dataset but free.
 */
import { Actor, log } from 'apify';
import { addToSummary, buildBatch, emptySummary } from './lib/convert.js';
import { InputError, collectRecords, normalizeInput, toConvertOptions } from './lib/input.js';
import { PPE_EVENTS, chargeEvent, describeCharging, remainingChargeable } from './lib/ppe.js';

const BATCH_SIZE = 200;

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput());
  log.info(describeCharging());

  const options = toConvertOptions(input);
  const collected = collectRecords(input);
  const records = collected.records.slice(0, input.maxItems);
  const summary = emptySummary();
  summary.skippedBlank = collected.skippedBlank;
  summary.truncatedByMaxItems = collected.records.length - records.length;
  if (summary.truncatedByMaxItems > 0) {
    log.warning(`Input has ${collected.records.length} entries; only the first ${records.length} are converted (maxItems).`);
  }
  if (summary.skippedBlank > 0) {
    log.info(`Skipped ${summary.skippedBlank} blank entr${summary.skippedBlank === 1 ? 'y' : 'ies'} (not converted, not charged).`);
  }

  let processed = 0;
  let unsaved = 0;
  let chargedEvents = 0;

  while (processed < records.length) {
    // Never convert rows nobody will be charged for: size the batch to the remaining budget.
    const remaining = remainingChargeable(PPE_EVENTS.DATE_CONVERTED);
    if (remaining <= 0) {
      summary.stoppedForBudget = true;
      break;
    }
    // safeBuildRow (inside buildBatch) turns an unexpected exception into one INTERNAL_ERROR row (free).
    const { rows, billable } = buildBatch(records, processed, remaining, options, BATCH_SIZE);

    try {
      // Rows first, charge second (same order as Actor.pushData(items, eventName)): a failed push is never billed.
      await Actor.pushData(rows as unknown as Record<string, unknown>[]);
    } catch (err) {
      unsaved += rows.length;
      processed += rows.length;
      log.error(`Could not save ${rows.length} result row(s): ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (billable > 0) {
      const outcome = await chargeEvent(PPE_EVENTS.DATE_CONVERTED, billable);
      chargedEvents += outcome.chargedCount;
    }
    for (const row of rows) addToSummary(summary, row);
    processed += rows.length;
  }
  if (summary.stoppedForBudget) log.warning('Your maximum charge per run (maxTotalChargeUsd) is reached; stopped early.');

  await Actor.setValue('SUMMARY', { ...summary, chargedEvents });
  const message =
    `Converted ${summary.converted} date${summary.converted === 1 ? '' : 's'}` +
    (summary.errors > 0 ? `, ${summary.errors} entr${summary.errors === 1 ? 'y' : 'ies'} could not be converted (free, see reasonCode)` : '') +
    (summary.stoppedForBudget ? `; stopped at your maximum charge (${records.length - processed} entries not processed)` : '') +
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
