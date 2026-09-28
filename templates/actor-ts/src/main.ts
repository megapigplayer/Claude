/**
 * Thin Apify wrapper for __ACTOR_TITLE__.
 *
 * All business logic lives in src/lib/*.ts (pure functions, no Apify imports, unit
 * tested in isolation). This file only: reads input, works through the items in batches,
 * pushes + charges one row per item, and never lets one bad item kill the whole run.
 */
import { Actor, log } from 'apify';
import { processItem } from './lib/example.js';
import { InputError, normalizeInput } from './lib/input.js';
import { describeCharging, PPE_EVENTS, pushResultsAndCharge, remainingChargeable } from './lib/ppe.js';

const BATCH_SIZE = 50;

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput());
  log.info(describeCharging());

  const items = input.items.slice(0, input.maxItems);
  if (input.items.length > items.length) {
    log.warning(`Input had ${input.items.length} items; only processing the first ${items.length} (maxItems).`);
  }

  let processed = 0;
  let failedRows = 0;
  let unsavedRows = 0;
  let stoppedForBudget = false;

  while (processed < items.length) {
    // Never compute rows nobody will be charged for: size the batch to the remaining budget.
    const remaining = remainingChargeable(PPE_EVENTS.TASK_COMPLETED);
    if (remaining <= 0) {
      stoppedForBudget = true;
      break;
    }
    const batch = items.slice(processed, processed + Math.min(BATCH_SIZE, remaining));

    // One try/catch per item: an unexpected exception becomes one failed row, never a failed run.
    const rows = batch.map((rawItem): Record<string, unknown> => {
      try {
        return { ...processItem(rawItem) };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`Unexpected error while processing one item: ${message}`);
        return { input: String(rawItem), ok: false, value: null, error: `internal_error: ${message}` };
      }
    });

    const outcome = await pushResultsAndCharge(rows, PPE_EVENTS.TASK_COMPLETED);
    if (!outcome.ok) {
      unsavedRows += rows.length;
      processed += batch.length;
      continue;
    }
    // In PPE runs the SDK saves only the rows that fit in maxTotalChargeUsd (pushedCount).
    failedRows += rows.slice(0, outcome.pushedCount).filter((r) => r.ok === false).length;
    processed += outcome.pushedCount;
    if (outcome.pushedCount < rows.length) {
      stoppedForBudget = true;
      break;
    }
  }

  if (stoppedForBudget) log.warning('maxTotalChargeUsd reached; stopped early instead of doing unpaid work.');
  log.info(`Done: ${processed} of ${items.length} item(s) processed, ${failedRows} reported as failed.`);

  if (unsavedRows > 0) {
    // Infrastructure problem (dataset push failed): fail loudly instead of silently returning less data.
    await Actor.fail(`${unsavedRows} result row(s) could not be saved to the dataset; see the log.`);
  } else {
    await Actor.exit(stoppedForBudget ? { statusMessage: `Stopped at your maximum charge after ${processed} item(s).` } : undefined);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  // Bad input is the caller's mistake; anything else is ours. Either way fail loudly
  // (exit code 1) instead of exiting 0 with an empty dataset.
  await Actor.fail(err instanceof InputError ? `Invalid input: ${message}` : `Actor run failed: ${message}`);
}
