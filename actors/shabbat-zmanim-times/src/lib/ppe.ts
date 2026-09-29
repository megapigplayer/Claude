/**
 * Pay-per-event (PPE) charging helper.
 *
 * This file is COPIED into every Actor's `src/lib/ppe.ts` (never imported across
 * folders) so each Actor stays self-contained: `apify push`, a standalone
 * `npm install` and `docker build` all work from the Actor folder alone. The canonical
 * copy is `templates/actor-ts/src/lib/ppe.ts`; if you improve it, change the template
 * first and then sync the improvement into existing Actors by hand.
 *
 * Every claim below was read from the installed apify@3.7.2 (see CONVENTIONS.md,
 * "Verified SDK facts", for file:line references):
 *
 * - `Actor.charge({ eventName, count })` resolves to
 *   `{ chargedCount, eventChargeLimitReached, chargeableWithinLimit }`. When the run is
 *   not pay-per-event (local run, no Apify token, unmonetised Actor) it does NOT throw:
 *   it logs one warning and resolves with `chargedCount: 0`.
 * - `Actor.pushData(items, eventName)` pushes to the default dataset and charges one
 *   `eventName` per pushed item. On a PPE run it silently DROPS rows that no longer fit in
 *   the budget (keeping the first ones), so the number of saved rows can be smaller than
 *   requested; the returned `chargedCount` is NOT that number (it also sums the synthetic
 *   `apify-default-dataset-item` event), hence `pushedCount` below is derived from the
 *   charging manager's per-event counter. It throws for event names starting with `apify-`
 *   (synthetic events are charged by the platform automatically) and if `Actor.init()` was
 *   not awaited.
 * - The SDK already enforces the run's `maxTotalChargeUsd` (env `ACTOR_MAX_TOTAL_CHARGE_USD`
 *   locally, the run option on the platform). We never re-implement that arithmetic; we
 *   only ask how many events still fit and stop doing paid work when it is zero.
 * - Locally, `ACTOR_TEST_PAY_PER_EVENT=true` (+ `ACTOR_USE_CHARGING_LOG_DATASET=true`)
 *   simulates PPE at a flat $1 per event and writes every charge to the local dataset
 *   `charging_log`; with `ACTOR_MAX_TOTAL_CHARGE_USD=N` at most N rows are saved. Observed with
 *   apify@3.7.2: one log entry per pushData call, `chargedCount` = rows saved, no synthetic
 *   `apify-default-dataset-item` entries. `scripts/smoke-local.mjs` uses this to check
 *   charging and the budget cap offline.
 *
 * Do not define BOTH a custom event and the synthetic `apify-default-dataset-item` event
 * in the Console pricing for the same thing: pushData on the default dataset would bill both.
 */
import { Actor, log } from 'apify';

/**
 * Event name(s) this Actor charges. Keep in sync with `pricing.json` in the Actor root
 * and with the event configured in Apify Console > Publication > Monetization.
 */
export const PPE_EVENTS = {
  LOCATION_WEEK: 'location-week',
} as const;

export interface ChargeOutcome {
  /** False only when an unexpected exception was caught and swallowed. */
  ok: boolean;
  /** Events actually charged (0 when not running as PPE or when the budget is used up). */
  chargedCount: number;
  /** True once no more events of this type fit within maxTotalChargeUsd. */
  limitReached: boolean;
  /** Set when ok is false. */
  error?: string;
}

export interface PushOutcome extends ChargeOutcome {
  /** Rows actually saved to the dataset (fewer than requested when maxTotalChargeUsd cut the batch). */
  pushedCount: number;
}

/**
 * Charge for a unit of work that is not itself a dataset row (e.g. "one event per job").
 * Safe to call with no PPE pricing / no token / local run: never throws.
 */
export async function chargeEvent(eventName: string, count = 1): Promise<ChargeOutcome> {
  try {
    const result = await Actor.charge({ eventName, count });
    return { ok: true, chargedCount: result.chargedCount, limitReached: result.eventChargeLimitReached };
  } catch (err) {
    const error = errMessage(err);
    log.warningOnce(`chargeEvent("${eventName}") failed, continuing without charging: ${error}`);
    return { ok: false, chargedCount: 0, limitReached: false, error };
  }
}

/**
 * Push result rows to the default dataset AND charge one `eventName` per saved row
 * ("one event per result"). Never throws. On failure nothing is retried: the SDK pushes
 * first and charges second, so a retry could deliver rows twice - the caller gets
 * `ok: false` and decides (the template fails the run at the end so data loss is never
 * silent). Push in batches (e.g. 50-100 rows), not one call per row: each call is one API
 * request on the platform.
 */
export async function pushResultsAndCharge(items: Record<string, unknown>[], eventName: string): Promise<PushOutcome> {
  if (items.length === 0) return { ok: true, pushedCount: 0, chargedCount: 0, limitReached: false };
  try {
    const before = chargedSoFar(eventName);
    const result = await Actor.pushData(items, eventName);
    const after = chargedSoFar(eventName);
    // Outside PPE runs every row is saved. In PPE runs each saved row charged exactly one event.
    const pushedCount =
      before !== null && after !== null ? Math.min(items.length, Math.max(0, after - before)) : items.length;
    return { ok: true, pushedCount, chargedCount: result.chargedCount, limitReached: result.eventChargeLimitReached };
  } catch (err) {
    const error = errMessage(err);
    log.error(`pushResultsAndCharge("${eventName}") failed for ${items.length} row(s), they were NOT saved: ${error}`);
    return { ok: false, pushedCount: 0, chargedCount: 0, limitReached: false, error };
  }
}

/** Single-row convenience wrapper around pushResultsAndCharge. */
export function pushResultAndCharge(item: Record<string, unknown>, eventName: string): Promise<PushOutcome> {
  return pushResultsAndCharge([item], eventName);
}

/**
 * How many more `eventName` events fit within maxTotalChargeUsd (Infinity when there is no
 * limit, outside pay-per-event runs, or if the charging state is unreadable). Use it to size
 * the next batch so the Actor never does work nobody will be charged - and thus paid - for.
 */
export function remainingChargeable(eventName: string): number {
  try {
    return Actor.getChargingManager().calculateMaxEventChargeCountWithinLimit(eventName);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** True when not even one more `eventName` charge fits within maxTotalChargeUsd. */
export function isBudgetExhausted(eventName: string): boolean {
  return remainingChargeable(eventName) <= 0;
}

/** One-line description of the charging mode for the run log. */
export function describeCharging(): string {
  try {
    const info = Actor.getChargingManager().getPricingInfo();
    if (!info.isPayPerEvent) return 'Pay-per-event pricing is not active for this run (local/dev): charge calls are no-ops.';
    const max = Number.isFinite(info.maxTotalChargeUsd) ? `$${info.maxTotalChargeUsd}` : 'unlimited';
    return `Pay-per-event pricing is active; max total charge for this run: ${max}.`;
  } catch {
    return 'Charging state unavailable; continuing without charging.';
  }
}

/** Events of this type charged so far in this run; null outside PPE runs or when unreadable. */
function chargedSoFar(eventName: string): number | null {
  try {
    const manager = Actor.getChargingManager();
    if (!manager.getPricingInfo().isPayPerEvent) return null;
    return manager.getChargedEventCount(eventName);
  } catch {
    return null;
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
