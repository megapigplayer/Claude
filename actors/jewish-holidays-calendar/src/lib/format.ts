/**
 * CSV and iCalendar (RFC 5545) serialization of the generated rows. Pure functions (no Apify
 * imports); main.ts always pushes the JSON rows to the dataset and, when the caller asked for
 * `format: "csv"` or `"ics"`, ALSO stores one of these as an extra file in the key-value store.
 */
import type { CalendarRow } from './holidays.js';

const CSV_COLUMNS: readonly (keyof CalendarRow)[] = [
  'date',
  'hebrewDate',
  'hebrewDateHe',
  'name',
  'nameHe',
  'category',
  'beginsEveningBefore',
  'isYomTov',
  'isIsraeliPublicHoliday',
  'memo',
];

function csvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** RFC 4180 CSV of the holiday rows only (the meta row is not tabular data for a spreadsheet). */
export function toCsv(rows: readonly CalendarRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    if (row.rowType !== 'holiday') continue;
    lines.push(CSV_COLUMNS.map((col) => csvField(row[col])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a line to 75 octets as RFC 5545 requires (naive but correct for our ASCII-heavy fields; non-ASCII lines are left unfolded rather than split mid-character). */
function foldLine(line: string): string {
  if (line.length <= 75 || /[^\x00-\x7f]/.test(line)) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  parts.push(rest);
  return parts.join('\r\n');
}

function icsStamp(now: Date): string {
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'event';
}

/**
 * A minimal, valid RFC 5545 VCALENDAR: one all-day VEVENT per holiday row. `now` is injected
 * (DTSTAMP) so the function stays pure and deterministic for tests; main.ts passes `new Date()`.
 */
export function toIcs(rows: readonly CalendarRow[], calendarName: string, now: Date): string {
  const stamp = icsStamp(now);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//jewish-holidays-calendar Apify Actor//EN', 'CALSCALE:GREGORIAN', foldLine(`X-WR-CALNAME:${escapeIcsText(calendarName)}`)];
  for (const row of rows) {
    if (row.rowType !== 'holiday' || row.date === null) continue;
    const dtstart = row.date.replace(/-/g, '');
    const title = row.name ?? row.nameHe ?? 'Holiday';
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${dtstart}-${slugify(title)}@jewish-holidays-calendar.apify`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${dtstart}`);
    lines.push(foldLine(`SUMMARY:${escapeIcsText(title)}`));
    if (row.memo) lines.push(foldLine(`DESCRIPTION:${escapeIcsText(row.memo)}`));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
