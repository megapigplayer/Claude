import { describe, expect, it } from 'vitest';
import { toCsv, toIcs } from '../src/lib/format.js';
import { generateCalendar } from '../src/lib/holidays.js';

const rows = generateCalendar({ year: 2026, yearType: 'gregorian', location: 'israel', include: ['major', 'fasts'], language: 'both' });

describe('toCsv', () => {
  it('has a header row and one data row per holiday row (not the meta row)', () => {
    const csv = toCsv(rows);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('date,hebrewDate,hebrewDateHe,name,nameHe,category,beginsEveningBefore,isYomTov,isIsraeliPublicHoliday,memo');
    const holidayCount = rows.filter((r) => r.rowType === 'holiday').length;
    expect(lines).toHaveLength(holidayCount + 1);
  });

  it('quotes fields containing a comma or quote', () => {
    const csv = toCsv([
      {
        rowType: 'holiday',
        date: '2026-01-01',
        hebrewDate: 'a, b',
        hebrewDateHe: null,
        name: 'Say "hi"',
        nameHe: null,
        category: 'major',
        beginsEveningBefore: true,
        isYomTov: true,
        isIsraeliPublicHoliday: null,
        memo: null,
        hebrewYear: 5786,
        isLeapYear: false,
        hebrewYearsInRange: null,
      },
    ]);
    expect(csv).toContain('"a, b"');
    expect(csv).toContain('"Say ""hi"""');
  });

  it('renders null as an empty field and booleans as true/false', () => {
    const csv = toCsv([
      {
        rowType: 'holiday',
        date: '2026-01-01',
        hebrewDate: null,
        hebrewDateHe: null,
        name: 'X',
        nameHe: null,
        category: 'major',
        beginsEveningBefore: false,
        isYomTov: false,
        isIsraeliPublicHoliday: null,
        memo: null,
        hebrewYear: 5786,
        isLeapYear: false,
        hebrewYearsInRange: null,
      },
    ]);
    const dataLine = csv.trimEnd().split('\r\n')[1];
    expect(dataLine).toBe('2026-01-01,,,X,,major,false,false,,');
  });

  it('never crashes on an empty row list', () => {
    expect(() => toCsv([])).not.toThrow();
    expect(toCsv([]).trimEnd()).toContain('date,hebrewDate');
  });
});

describe('toIcs', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  const ics = toIcs(rows, 'Jewish holidays 2026 (israel)', now);

  it('is a well-formed VCALENDAR with a VEVENT per holiday row', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    const beginCount = (ics.match(/BEGIN:VEVENT/g) ?? []).length;
    const endCount = (ics.match(/END:VEVENT/g) ?? []).length;
    const holidayCount = rows.filter((r) => r.rowType === 'holiday').length;
    expect(beginCount).toBe(holidayCount);
    expect(endCount).toBe(holidayCount);
  });

  it('every VEVENT has a DTSTART;VALUE=DATE in YYYYMMDD form and a SUMMARY', () => {
    for (const m of ics.matchAll(/DTSTART;VALUE=DATE:(\d{8})/g)) expect(m[1]).toMatch(/^\d{8}$/);
    expect(ics).toMatch(/SUMMARY:Rosh Hashana/);
  });

  it('escapes commas, semicolons and backslashes in text fields', () => {
    const escaped = toIcs(
      [
        {
          rowType: 'holiday',
          date: '2026-01-01',
          hebrewDate: null,
          hebrewDateHe: null,
          name: 'A, B; C\\D',
          nameHe: null,
          category: 'major',
          beginsEveningBefore: true,
          isYomTov: true,
          isIsraeliPublicHoliday: null,
          memo: null,
          hebrewYear: 5786,
          isLeapYear: false,
          hebrewYearsInRange: null,
        },
      ],
      'Test',
      now,
    );
    expect(escaped).toContain('SUMMARY:A\\, B\\; C\\\\D');
  });

  it('is deterministic given the same `now` (no hidden randomness/timestamps)', () => {
    expect(toIcs(rows, 'X', now)).toBe(toIcs(rows, 'X', now));
  });

  it('never crashes on an empty row list', () => {
    expect(() => toIcs([], 'Empty', now)).not.toThrow();
  });
});
