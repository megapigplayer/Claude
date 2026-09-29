import { describe, expect, it } from 'vitest';
import { type ResultRow, buildRowsForLocation, isChargeable, safeBuildRowsForLocation } from '../src/lib/batch.js';
import type { CivilDate } from '../src/lib/dates.js';
import { DEFAULT_HAVDALAH_DEG } from '../src/lib/week.js';
import type { WeekOptions } from '../src/lib/week.js';

const OPTS: WeekOptions = {
  candleLightingMinutes: null,
  havdalahMinutes: null,
  havdalahDeg: DEFAULT_HAVDALAH_DEG,
  includeShabbat: true,
  includeZmanim: false,
  includeHolidays: false,
  useElevation: true,
};

const FRIDAY: CivilDate = { year: 2026, month: 10, day: 9 };

describe('buildRowsForLocation', () => {
  it('produces one row per week, all "ok", for a valid city', () => {
    const rows = buildRowsForLocation({ input: 'Jerusalem', position: 1, raw: 'Jerusalem' }, FRIDAY, 3, OPTS);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.week)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.status === 'ok')).toBe(true);
    expect(rows.every((r) => r.input === 'Jerusalem')).toBe(true);
    expect(rows.every((r) => r.position === 1)).toBe(true);
  });

  it('consecutive weeks are 7 days apart', () => {
    const rows = buildRowsForLocation({ input: 'Jerusalem', position: 1, raw: 'Jerusalem' }, FRIDAY, 2, OPTS);
    expect(rows[0]?.friday).toBe('2026-10-09');
    expect(rows[1]?.friday).toBe('2026-10-16');
  });

  it('rolls the first week forward when startDate is not a Friday, and only flags week 1', () => {
    const notFriday: CivilDate = { year: 2026, month: 10, day: 6 }; // Tuesday
    const rows = buildRowsForLocation({ input: 'Jerusalem', position: 1, raw: 'Jerusalem' }, notFriday, 2, OPTS);
    expect(rows[0]?.friday).toBe('2026-10-09');
    expect(rows[0]?.fridayRolledForward).toBe(true);
    expect(rows[1]?.fridayRolledForward).toBe(false);
  });

  it('an unresolvable location produces one error row per requested week, all free (not chargeable)', () => {
    const rows = buildRowsForLocation({ input: 'NotACity', position: 2, raw: 'NotACity' }, FRIDAY, 3, OPTS);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === 'error' && r.reasonCode === 'UNKNOWN_CITY')).toBe(true);
    expect(rows.every((r) => !isChargeable(r))).toBe(true);
    expect(rows.every((r) => r.location === null && r.friday === null)).toBe(true);
  });

  it('echoes a coordinate-object entry as JSON in "input"', () => {
    const raw = { latitude: 41.85, longitude: -87.65, tzid: 'America/Chicago' };
    const rows = buildRowsForLocation({ input: JSON.stringify(raw), position: 1, raw }, FRIDAY, 1, OPTS);
    expect(rows[0]?.input).toBe('{"latitude":41.85,"longitude":-87.65,"tzid":"America/Chicago"}');
    expect(rows[0]?.location?.tzid).toBe('America/Chicago');
  });
});

describe('safeBuildRowsForLocation', () => {
  it('turns an unexpected throw into one INTERNAL_ERROR row per week instead of propagating', () => {
    const boom = (): ResultRow[] => {
      throw new Error('kaboom');
    };
    const rows = safeBuildRowsForLocation({ input: 'x', position: 1, raw: 'x' }, FRIDAY, 2, OPTS, boom as never);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.reasonCode === 'INTERNAL_ERROR')).toBe(true);
    expect(rows[0]?.reason).toContain('kaboom');
    expect(rows.every((r) => !isChargeable(r))).toBe(true);
  });

  it('a normal location is unaffected', () => {
    const rows = safeBuildRowsForLocation({ input: 'Jerusalem', position: 1, raw: 'Jerusalem' }, FRIDAY, 1, OPTS);
    expect(rows[0]?.status).toBe('ok');
  });
});

describe('isChargeable', () => {
  it('only "ok" rows are chargeable', () => {
    const [ok] = buildRowsForLocation({ input: 'Jerusalem', position: 1, raw: 'Jerusalem' }, FRIDAY, 1, OPTS);
    const [bad] = buildRowsForLocation({ input: 'NotACity', position: 1, raw: 'NotACity' }, FRIDAY, 1, OPTS);
    expect(isChargeable(ok as ResultRow)).toBe(true);
    expect(isChargeable(bad as ResultRow)).toBe(false);
  });
});
