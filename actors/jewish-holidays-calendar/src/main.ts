/**
 * Thin Apify wrapper for the Jewish Holidays Calendar API.
 *
 * Unlike this repo's per-row Actors, one run computes ONE calendar (a year + location + category
 * selection) and charges exactly one `calendar-year` event for it - the dataset can hold anywhere
 * from a handful to a few hundred rows depending on `include`, but that is one unit of work, not
 * one per row (see pricing.json / TOP60.md 4.3: "calendar-year, once per year and location mode").
 */
import { Actor, log } from 'apify';
import { toCsv, toIcs } from './lib/format.js';
import { generateCalendar } from './lib/holidays.js';
import { InputError, normalizeInput } from './lib/input.js';
import { PPE_EVENTS, chargeEvent, describeCharging, remainingChargeable } from './lib/ppe.js';

await Actor.init();

try {
  const input = normalizeInput(await Actor.getInput());
  log.info(describeCharging());

  if (remainingChargeable(PPE_EVENTS.CALENDAR_YEAR) <= 0) {
    // Never do work nobody will be charged for.
    const message = 'Your maximum charge per run (maxTotalChargeUsd) is already reached; nothing was generated.';
    log.warning(message);
    await Actor.setValue('SUMMARY', { generated: false, reason: 'budget_exhausted' });
    await Actor.exit({ statusMessage: message });
  } else {
    const rows = generateCalendar(input);
    const holidayRows = rows.filter((r) => r.rowType === 'holiday');

    let pushFailed = false;
    try {
      await Actor.pushData(rows as unknown as Record<string, unknown>[]);
    } catch (err) {
      pushFailed = true;
      log.error(`Could not save the ${rows.length} generated row(s): ${err instanceof Error ? err.message : String(err)}`);
    }

    if (pushFailed) {
      // Infrastructure problem: fail loudly instead of silently returning less data.
      await Actor.fail(`The generated calendar could not be saved to the dataset; see the log.`);
    } else {
      let outputKey: string | null = null;
      if (input.format === 'csv') {
        await Actor.setValue('OUTPUT', toCsv(rows), { contentType: 'text/csv; charset=utf-8' });
        outputKey = 'OUTPUT';
      } else if (input.format === 'ics') {
        const name = `Jewish holidays ${input.year} (${input.location})`;
        await Actor.setValue('OUTPUT', toIcs(rows, name, new Date()), { contentType: 'text/calendar; charset=utf-8' });
        outputKey = 'OUTPUT';
      }

      const charge = await chargeEvent(PPE_EVENTS.CALENDAR_YEAR, 1);
      await Actor.setValue('SUMMARY', {
        generated: true,
        year: input.year,
        yearType: input.yearType,
        location: input.location,
        include: input.include,
        rowCount: holidayRows.length,
        chargedEvents: charge.chargedCount,
        outputKey,
      });

      const message =
        `Generated ${holidayRows.length} row(s) for ${input.yearType === 'hebrew' ? 'Hebrew' : 'Gregorian'} year ${input.year} (${input.location})` +
        (outputKey ? `; also wrote key-value store record "${outputKey}" (${input.format}).` : '.');
      log.info(message);
      await Actor.exit({ statusMessage: message });
    }
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  await Actor.fail(err instanceof InputError ? `Invalid input: ${message}` : `Actor run failed: ${message}`);
}
