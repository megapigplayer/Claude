/**
 * Thin Apify wrapper for the Israeli Business-Day and Payment-Terms Calculator.
 *
 * All business logic lives in src/lib/*.ts (pure functions, unit tested; only ppe.ts imports the
 * Apify SDK). This file: reads input, computes each `calculations[]` entry against the top-level
 * defaults, pushes one dataset row per entry (in input order, error rows included) and charges one
 * `calculation` event per row that computed successfully. A malformed calculation entry (bad dates,
 * missing operation-specific field) is visible in the dataset but free - it never got processed.
 */
import { Actor, log } from 'apify';
import { type CalculationInput, buildRow } from './lib/calculate.js';
import { InputError, mergeCalculation, normalizeInput } from './lib/input.js';
import { PPE_EVENTS, chargeEvent, describeCharging, remainingChargeable } from './lib/ppe.js';

const BATCH_SIZE = 200;

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput());
  log.info(describeCharging());
  const { calculations, ...topLevel } = input;

  let processed = 0;
  let converted = 0;
  let errors = 0;
  let unsaved = 0;
  let chargedEvents = 0;
  let stoppedForBudget = false;

  while (processed < calculations.length) {
    const remaining = remainingChargeable(PPE_EVENTS.CALCULATION);
    if (remaining <= 0) {
      stoppedForBudget = true;
      break;
    }

    const rows: Record<string, unknown>[] = [];
    let billable = 0;
    while (rows.length < BATCH_SIZE && processed + rows.length < calculations.length && billable < remaining) {
      const entry = calculations[processed + rows.length];
      const position = processed + rows.length + 1;
      let row: Record<string, unknown>;
      try {
        const merged: CalculationInput = mergeCalculation(entry, topLevel);
        row = { ...buildRow({ input: typeof entry === 'string' ? entry : JSON.stringify(entry), position }, merged) };
      } catch (err) {
        // A malformed entry (mergeCalculation threw, e.g. entry is not an object): one free error row.
        const message = err instanceof Error ? err.message : String(err);
        row = {
          input: typeof entry === 'string' ? entry : JSON.stringify(entry),
          position,
          operation: null,
          status: 'error',
          reasonCode: 'INVALID_CALCULATION',
          reason: message,
        };
      }
      rows.push(row);
      if (row.status === 'ok') billable += 1;
    }

    try {
      await Actor.pushData(rows);
    } catch (err) {
      unsaved += rows.length;
      processed += rows.length;
      log.error(`Could not save ${rows.length} result row(s): ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (billable > 0) {
      const outcome = await chargeEvent(PPE_EVENTS.CALCULATION, billable);
      chargedEvents += outcome.chargedCount;
    }
    for (const row of rows) {
      if (row.status === 'ok') converted++;
      else errors++;
    }
    processed += rows.length;
  }

  if (stoppedForBudget) log.warning('Your maximum charge per run (maxTotalChargeUsd) is reached; stopped early.');
  const message =
    `Computed ${converted} calculation${converted === 1 ? '' : 's'}` +
    (errors > 0 ? `, ${errors} entr${errors === 1 ? 'y' : 'ies'} could not be computed (free, see reasonCode)` : '') +
    (stoppedForBudget ? `; stopped at your maximum charge (${calculations.length - processed} entries not processed)` : '') +
    '.';
  log.info(message);
  await Actor.setValue('SUMMARY', { total: processed, converted, errors, chargedEvents, stoppedForBudget });

  if (unsaved > 0) {
    await Actor.fail(`${unsaved} result row(s) could not be saved to the dataset; see the log.`);
  } else {
    await Actor.exit({ statusMessage: message });
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await Actor.fail(err instanceof InputError ? `Invalid input: ${message}` : `Actor run failed: ${message}`);
}
