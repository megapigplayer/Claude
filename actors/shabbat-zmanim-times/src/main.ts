/**
 * Thin Apify wrapper for Shabbat Candle-Lighting and Zmanim Times.
 *
 * All business logic lives in src/lib/*.ts (pure functions, unit tested; only ppe.ts imports the
 * Apify SDK). Each location's full set of `weeks` rows is treated as one atomic unit of work: if it
 * would not fully fit in the caller's remaining budget, it is skipped entirely (never partially
 * computed/paid) and the run stops there - see src/lib/batch.ts for why rows are charged this way.
 */
import { Actor, log } from 'apify';
import { formatIsoCivilDate, isChargeable, parseIsoCivilDate, safeBuildRowsForLocation } from './lib/batch.js';
import { InputError, normalizeInput } from './lib/input.js';
import { PPE_EVENTS, chargeEvent, describeCharging, remainingChargeable } from './lib/ppe.js';
import type { WeekOptions } from './lib/week.js';

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput());
  log.info(describeCharging());

  const startDate = parseIsoCivilDate(input.startDate);
  if (!startDate) throw new InputError(`Input field "startDate" must be a real ISO date (YYYY-MM-DD); got "${input.startDate}".`);

  const options: WeekOptions = {
    candleLightingMinutes: input.candleLightingMinutes,
    havdalahMinutes: input.havdalahMinutes,
    havdalahDeg: input.havdalahDeg,
    includeShabbat: input.include.includes('shabbat'),
    includeZmanim: input.include.includes('zmanim'),
    includeHolidays: input.include.includes('holidays'),
    // false matches @hebcal/core's own CalOptions.useElevation default and produces the
    // conventional published candle-lighting offsets (e.g. Jerusalem 40 min); see week.ts.
    useElevation: false,
  };

  // Echo + skip blanks, same InputRecord pattern as this repo's other list-of-items Actors.
  const records: { input: string; position: number; raw: unknown }[] = [];
  let skippedBlank = 0;
  for (const entry of input.locations) {
    if (entry === null || entry === undefined || (typeof entry === 'string' && entry.trim() === '')) {
      skippedBlank++;
      continue;
    }
    const echoed =
      typeof entry === 'string'
        ? entry
        : (() => {
            try {
              return JSON.stringify(entry);
            } catch {
              return '[object]';
            }
          })();
    records.push({ input: echoed, position: records.length + 1, raw: entry });
  }
  if (skippedBlank > 0) log.info(`Skipped ${skippedBlank} blank location entr${skippedBlank === 1 ? 'y' : 'ies'} (not computed, not charged).`);

  let pushedRows = 0;
  let chargedEvents = 0;
  let unsaved = 0;
  let stoppedForBudget = false;

  for (const record of records) {
    const rows = safeBuildRowsForLocation(record, startDate, input.weeks, options);
    const okCount = rows.filter(isChargeable).length;
    const remaining = remainingChargeable(PPE_EVENTS.LOCATION_WEEK);
    if (okCount > remaining) {
      stoppedForBudget = true;
      break;
    }

    try {
      await Actor.pushData(rows as unknown as Record<string, unknown>[]);
    } catch (err) {
      unsaved += rows.length;
      log.error(`Could not save ${rows.length} row(s) for "${record.input}": ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    pushedRows += rows.length;
    if (okCount > 0) {
      const outcome = await chargeEvent(PPE_EVENTS.LOCATION_WEEK, okCount);
      chargedEvents += outcome.chargedCount;
    }
  }

  if (stoppedForBudget) log.warning('Your maximum charge per run (maxTotalChargeUsd) would be exceeded by the next location; stopped early instead of doing unpaid work.');

  const message =
    `Generated ${pushedRows} row(s) for ${records.length} location(s) x ${input.weeks} week(s) starting ${formatIsoCivilDate(startDate)}` +
    (stoppedForBudget ? '; stopped at your maximum charge (see the log).' : '.');
  await Actor.setValue('SUMMARY', { pushedRows, chargedEvents, stoppedForBudget });
  log.info(message);

  if (unsaved > 0) {
    // Infrastructure problem (dataset push failed): fail loudly instead of silently returning less data.
    await Actor.fail(`${unsaved} result row(s) could not be saved to the dataset; see the log.`);
  } else {
    await Actor.exit({ statusMessage: message });
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await Actor.fail(err instanceof InputError ? `Invalid input: ${message}` : `Actor run failed: ${message}`);
}
