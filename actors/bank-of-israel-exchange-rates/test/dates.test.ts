import { describe, expect, it } from 'vitest';
import { addDays, diffDays, eachDate, fromEpochDay, isValidIsoDate, israelDate, israelMinutesOfDay, parseDateInput, toEpochDay } from '../src/lib/dates.js';
import { mulberry32 } from './helpers.js';

describe('isValidIsoDate', () => {
  it('accepts real calendar dates only', () => {
    for (const ok of ['2025-01-07', '2024-02-29', '2000-02-29', '1999-12-31', '2026-09-23']) expect(isValidIsoDate(ok), ok).toBe(true);
    for (const bad of ['2025-02-29', '2100-02-29', '2025-13-01', '2025-00-10', '2025-04-31', '2025-1-7', '25-01-07', '2025/01/07', '', 'today', '2025-01-07T00:00', '0000-01-01', '3000-01-01']) {
      expect(isValidIsoDate(bad), bad).toBe(false);
    }
  });
});

describe('epoch-day arithmetic', () => {
  it('round-trips and adds days across month, year and leap boundaries', () => {
    expect(toEpochDay('1970-01-01')).toBe(0);
    expect(fromEpochDay(0)).toBe('1970-01-01');
    expect(addDays('2025-01-31', 1)).toBe('2025-02-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
    expect(addDays('2025-01-01', -1)).toBe('2024-12-31');
    expect(addDays('2026-09-23', -14)).toBe('2026-09-09');
    expect(diffDays('2025-01-07', '2025-01-02')).toBe(5);
    expect(diffDays('2025-01-02', '2025-01-07')).toBe(-5);
    expect(() => toEpochDay('nope')).toThrow(RangeError);
  });

  it('agrees with the runtime Date for random dates (independent oracle)', () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const ms = Date.UTC(1990, 0, 1) + Math.floor(rnd() * 50 * 365 * 86400000);
      const iso = new Date(ms).toISOString().slice(0, 10);
      const delta = Math.floor(rnd() * 800) - 400;
      expect(addDays(iso, delta)).toBe(new Date(Date.parse(`${iso}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10));
    }
  });

  it('eachDate is inclusive and empty for reversed ranges', () => {
    expect([...eachDate('2025-01-05', '2025-01-09')]).toEqual(['2025-01-05', '2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09']);
    expect([...eachDate('2025-01-05', '2025-01-05')]).toEqual(['2025-01-05']);
    expect([...eachDate('2025-01-06', '2025-01-05')]).toEqual([]);
    expect([...eachDate('2024-02-28', '2024-03-01')]).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  });
});

describe('Israel wall clock (Asia/Jerusalem)', () => {
  it('rolls the date at Israeli midnight in winter time (UTC+2)', () => {
    expect(israelDate(new Date('2026-01-15T21:59:00Z'))).toBe('2026-01-15');
    expect(israelDate(new Date('2026-01-15T22:00:00Z'))).toBe('2026-01-16');
  });

  it('rolls the date at Israeli midnight in summer time (UTC+3)', () => {
    expect(israelDate(new Date('2026-07-01T20:59:00Z'))).toBe('2026-07-01');
    expect(israelDate(new Date('2026-07-01T21:00:00Z'))).toBe('2026-07-02');
  });

  it('handles both daylight-saving switch days of 2026 (27 March and 25 October)', () => {
    // Spring forward: 27 March 2026, 02:00 IST (= 00:00 UTC) becomes 03:00 IDT.
    expect(israelMinutesOfDay(new Date('2026-03-26T23:30:00Z'))).toBe(1 * 60 + 30); // 01:30 IST, before the switch
    expect(israelMinutesOfDay(new Date('2026-03-27T00:30:00Z'))).toBe(3 * 60 + 30); // 03:30 IDT, after the switch
    expect(israelDate(new Date('2026-03-26T22:00:00Z'))).toBe('2026-03-27');
    // Fall back: 25 October 2026, 02:00 IDT (= 23:00 UTC on the 24th) becomes 01:00 IST.
    expect(israelMinutesOfDay(new Date('2026-10-24T22:30:00Z'))).toBe(1 * 60 + 30); // 01:30 IDT
    expect(israelMinutesOfDay(new Date('2026-10-24T23:30:00Z'))).toBe(1 * 60 + 30); // 01:30 IST (the repeated hour)
    expect(israelDate(new Date('2026-10-24T21:00:00Z'))).toBe('2026-10-25');
  });

  it('reports minutes since local midnight (15:45 is 945 in both seasons)', () => {
    expect(israelMinutesOfDay(new Date('2026-01-15T13:45:00Z'))).toBe(945);
    expect(israelMinutesOfDay(new Date('2026-07-01T12:45:00Z'))).toBe(945);
    expect(israelMinutesOfDay(new Date('2026-01-15T22:00:00Z'))).toBe(0);
  });
});

describe('parseDateInput', () => {
  const now = new Date('2026-09-29T10:00:00Z');

  it('accepts YYYY-MM-DD and ignores a trailing time without shifting the date', () => {
    expect(parseDateInput('2025-01-07', now)).toEqual({ ok: true, iso: '2025-01-07' });
    expect(parseDateInput('  2025-01-07  ', now)).toEqual({ ok: true, iso: '2025-01-07' });
    expect(parseDateInput('2025-01-07T00:00:00Z', now)).toEqual({ ok: true, iso: '2025-01-07' });
    expect(parseDateInput('2025-01-07T23:59:59.999+02:00', now)).toEqual({ ok: true, iso: '2025-01-07' });
    expect(parseDateInput('2025-01-07 08:30', now)).toEqual({ ok: true, iso: '2025-01-07' });
  });

  it('resolves "today" to the current Israeli date, case-insensitively', () => {
    expect(parseDateInput('today', now)).toEqual({ ok: true, iso: '2026-09-29' });
    expect(parseDateInput('TODAY', now)).toEqual({ ok: true, iso: '2026-09-29' });
    expect(parseDateInput('today', new Date('2026-09-29T21:30:00Z'))).toEqual({ ok: true, iso: '2026-09-30' }); // already tomorrow in Israel
  });

  it('rejects ambiguous slash and dot formats with an explanation', () => {
    for (const bad of ['07/01/2025', '7.1.2025', '01-07-2025', '2025/01/07', 'Jan 7 2025']) {
      const r = parseDateInput(bad, now);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/YYYY-MM-DD/);
    }
    const slash = parseDateInput('07/01/2025', now);
    expect(slash.ok || slash.reason).toMatch(/ambiguous/);
  });

  it('rejects impossible dates, empty values and non-strings', () => {
    expect(parseDateInput('2025-02-30', now)).toMatchObject({ ok: false });
    expect(parseDateInput('', now)).toMatchObject({ ok: false });
    expect(parseDateInput('   ', now)).toMatchObject({ ok: false });
    expect(parseDateInput(20250107, now)).toMatchObject({ ok: false });
    expect(parseDateInput(null, now)).toMatchObject({ ok: false });
    expect(parseDateInput(undefined, now)).toMatchObject({ ok: false });
  });
});
