import { describe, expect, it } from 'vitest';
import { MONTH_ADAR_I, MONTH_ADAR_II, MONTH_TISHREI } from '../src/lib/hebrew.js';
import { cleanText, lookupMonthName, parseDateItem, parseDateString, parseGematriya } from '../src/lib/parse.js';

describe('cleanText', () => {
  it('strips RTL marks, bidi controls and normalizes whitespace', () => {
    expect(cleanText('‎2026-09-12‏')).toBe('2026-09-12');
    expect(cleanText('17  Tishrei   5787')).toBe('17 Tishrei 5787');
    expect(cleanText('  x  ')).toBe('x');
  });

  it('turns a maqaf (U+05BE, Hebrew hyphen) into a space', () => {
    expect(cleanText('י״ז־בתשרי')).toBe('י״ז בתשרי');
  });
});

describe('lookupMonthName', () => {
  it('recognizes English transliterations, case-insensitively', () => {
    expect(lookupMonthName('Tishrei')).toEqual({ month: 7 });
    expect(lookupMonthName('CHESHVAN')).toEqual({ month: 8 });
    expect(lookupMonthName('nissan')).toEqual({ month: 1 });
  });

  it('a bare "Adar" is reported as ambiguous (needs the year)', () => {
    expect(lookupMonthName('Adar')).toEqual({ adar: true });
    expect(lookupMonthName('אדר')).toEqual({ adar: true });
  });

  it('"Adar I" / "Adar II" resolve to explicit months', () => {
    expect(lookupMonthName('Adar I')).toEqual({ month: MONTH_ADAR_I, explicitAdarI: true });
    expect(lookupMonthName('Adar II')).toEqual({ month: MONTH_ADAR_II });
    expect(lookupMonthName('אדר ב')).toEqual({ month: MONTH_ADAR_II });
  });

  it('recognizes Hebrew month names with or without a leading ב', () => {
    expect(lookupMonthName('תשרי')).toEqual({ month: 7 });
    expect(lookupMonthName('בתשרי')).toEqual({ month: 7 });
  });

  it('returns null for an unknown word', () => {
    expect(lookupMonthName('January')).toBeNull();
    expect(lookupMonthName('xyz')).toBeNull();
    expect(lookupMonthName('')).toBeNull();
  });
});

describe('parseGematriya', () => {
  it('parses simple and punctuated numerals', () => {
    expect(parseGematriya('י״ז')).toBe(17);
    expect(parseGematriya('יז')).toBe(17);
    expect(parseGematriya("ל'")).toBe(30);
    expect(parseGematriya('ט״ו')).toBe(15);
  });

  it('parses a thousands-prefixed year', () => {
    expect(parseGematriya('ה׳תשפ״ז')).toBe(5787);
  });

  it('rejects malformed numerals (letters increasing, non-Hebrew)', () => {
    expect(parseGematriya('אב')).toBeNull(); // increasing (1 then 2) - invalid
    expect(parseGematriya('abc')).toBeNull();
    expect(parseGematriya('')).toBeNull();
  });
});

describe('parseDateString: Gregorian ISO-like', () => {
  it('accepts YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD', () => {
    for (const s of ['2026-09-12', '2026/09/12', '2026.09.12']) {
      expect(parseDateString(s, 'auto')).toMatchObject({ kind: 'gregorian' });
    }
  });

  it('tolerates an exact-midnight time (spreadsheet artifact) but rejects any other time', () => {
    expect(parseDateString('2026-09-12T00:00:00', 'auto')).toMatchObject({ kind: 'gregorian' });
    expect(parseDateString('2026-09-12T00:00:00Z', 'auto')).toMatchObject({ kind: 'gregorian' });
    expect(parseDateString('2026-09-12T14:30:00', 'auto')).toMatchObject({ kind: 'error', code: 'TIME_NOT_SUPPORTED' });
  });

  it('rejects an impossible calendar date without rolling it over', () => {
    expect(parseDateString('2026-02-30', 'auto')).toMatchObject({ kind: 'error', code: 'INVALID_DATE' });
  });

  it('rejects ambiguous numeric day/month/year order', () => {
    expect(parseDateString('12/09/2026', 'auto')).toMatchObject({ kind: 'error', code: 'AMBIGUOUS_DATE_FORMAT' });
    expect(parseDateString('1-2-2026', 'auto')).toMatchObject({ kind: 'error', code: 'AMBIGUOUS_DATE_FORMAT' });
  });

  it('direction="h2g" rejects a Gregorian-shaped string', () => {
    expect(parseDateString('2026-09-12', 'h2g')).toMatchObject({ kind: 'error', code: 'WRONG_DIRECTION' });
  });

  it('blank input is "blank", not an error', () => {
    expect(parseDateString('   ', 'auto')).toEqual({ kind: 'blank' });
    expect(parseDateString('', 'auto')).toEqual({ kind: 'blank' });
  });
});

describe('parseDateString: English Hebrew dates', () => {
  it('"17 Tishrei 5787" and "Tishrei 17, 5787"', () => {
    const expected = { kind: 'hebrew', date: { year: 5787, month: MONTH_TISHREI, day: 17 } };
    expect(parseDateString('17 Tishrei 5787', 'auto')).toMatchObject(expected);
    expect(parseDateString('17th of Tishrei, 5787', 'auto')).toMatchObject(expected);
    expect(parseDateString('Tishrei 17, 5787', 'auto')).toMatchObject(expected);
  });

  it('"1 Adar II 5784" resolves the explicit Adar II', () => {
    const r = parseDateString('1 Adar II 5784', 'auto');
    if (r.kind === 'hebrew') expect(r.date.month).toBe(MONTH_ADAR_II);
    else throw new Error(`expected hebrew, got ${JSON.stringify(r)}`);
  });

  it('direction="g2h" rejects a Hebrew-shaped string', () => {
    expect(parseDateString('17 Tishrei 5787', 'g2h')).toMatchObject({ kind: 'error', code: 'UNRECOGNIZED_FORMAT' });
  });

  it('unknown English month name', () => {
    expect(parseDateString('17 Foobar 5787', 'auto')).toMatchObject({ kind: 'error', code: 'UNKNOWN_MONTH' });
  });
});

describe('parseDateString: Hebrew letters', () => {
  it('"י״ז בתשרי תשפ״ז"', () => {
    expect(parseDateString('י״ז בתשרי תשפ״ז', 'auto')).toMatchObject({ kind: 'hebrew', date: { year: 5787, month: MONTH_TISHREI, day: 17 } });
  });

  it('"ט״ו באדר ב׳ תשפ״ד" (15 Adar II)', () => {
    const r = parseDateString('ט״ו באדר ב׳ תשפ״ד', 'auto');
    expect(r).toMatchObject({ kind: 'hebrew', date: { day: 15, month: MONTH_ADAR_II } });
  });
});

describe('parseDateString: leap-year Adar ambiguity', () => {
  it('a bare "Adar" in a leap Hebrew year is rejected as ambiguous', () => {
    // 5784 was a leap year (has Adar I / Adar II).
    expect(parseDateString('10 Adar 5784', 'auto')).toMatchObject({ kind: 'error', code: 'AMBIGUOUS_ADAR' });
  });

  it('a bare "Adar" in a regular Hebrew year resolves to the single Adar', () => {
    // 5786 is a regular (non-leap) year.
    expect(parseDateString('10 Adar 5786', 'auto')).toMatchObject({ kind: 'hebrew', date: { month: MONTH_ADAR_I, day: 10 } });
  });

  it('explicit "Adar I" in a regular year is rejected (Adar I only exists in leap years)', () => {
    expect(parseDateString('10 Adar I 5786', 'auto')).toMatchObject({ kind: 'error', code: 'INVALID_MONTH_FOR_YEAR' });
  });

  it('"Adar II" in a regular year is rejected the same way', () => {
    expect(parseDateString('10 Adar II 5786', 'auto')).toMatchObject({ kind: 'error', code: 'INVALID_MONTH_FOR_YEAR' });
  });
});

describe('parseDateString: day-of-month bounds', () => {
  it('30 Kislev is rejected in a Hebrew year where Kislev is short', () => {
    // Search near a known regular year for one with 29-day Kislev via the parser's own error text
    // (kept independent of hebrew-calendar.ts by trying several years and requiring at least one hit).
    let sawShort = false;
    let sawLong = false;
    for (let y = 5780; y <= 5800; y++) {
      const r = parseDateString(`30 Kislev ${y}`, 'auto');
      if (r.kind === 'hebrew') sawLong = true;
      else if (r.kind === 'error' && r.code === 'INVALID_DAY_FOR_MONTH') sawShort = true;
    }
    expect(sawShort, 'expected at least one short-Kislev year in range').toBe(true);
    expect(sawLong, 'expected at least one long-Kislev year in range').toBe(true);
  });

  it('day 0 or day 31 is invalid', () => {
    expect(parseDateString('0 Tishrei 5787', 'auto')).toMatchObject({ kind: 'error' });
    expect(parseDateString('31 Tishrei 5787', 'auto')).toMatchObject({ kind: 'error', code: 'INVALID_DAY_FOR_MONTH' });
  });
});

describe('parseDateItem: objects and unsupported items', () => {
  it('{"date": "..."} is a Gregorian object', () => {
    expect(parseDateItem({ date: '2026-09-12' }, 'auto')).toMatchObject({ kind: 'gregorian' });
  });

  it('{"date": "...", "afterSunset": true} carries afterSunset through', () => {
    expect(parseDateItem({ date: '2026-09-12', afterSunset: true }, 'auto')).toMatchObject({ kind: 'gregorian', afterSunset: true });
  });

  it('{"day","month","year"} with a Hebrew-range year is a Hebrew date; month can be a name or a number', () => {
    expect(parseDateItem({ day: 17, month: 'Tishrei', year: 5787 }, 'auto')).toMatchObject({ kind: 'hebrew', date: { day: 17, month: 7, year: 5787 } });
    expect(parseDateItem({ day: 17, month: 7, year: 5787 }, 'auto')).toMatchObject({ kind: 'hebrew', date: { day: 17, month: 7, year: 5787 } });
  });

  it('an explicit "calendar" field overrides the year-based heuristic', () => {
    expect(parseDateItem({ day: 1, month: 1, year: 2026, calendar: 'gregorian' }, 'auto')).toMatchObject({ kind: 'gregorian' });
  });

  it('null/undefined is blank; an array is unsupported', () => {
    expect(parseDateItem(null, 'auto')).toEqual({ kind: 'blank' });
    expect(parseDateItem(undefined, 'auto')).toEqual({ kind: 'blank' });
    expect(parseDateItem([1, 2], 'auto')).toMatchObject({ kind: 'error', code: 'UNSUPPORTED_ITEM' });
    expect(parseDateItem(42, 'auto')).toMatchObject({ kind: 'error', code: 'UNSUPPORTED_ITEM' });
  });

  it('never throws for a hostile object (toString() throwing, circular)', () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'date', { get() { throw new Error('boom'); } });
    expect(() => parseDateItem(hostile, 'auto')).not.toThrow();
    expect(parseDateItem(hostile, 'auto')).toMatchObject({ kind: 'error' });
  });
});
