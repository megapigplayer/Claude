/**
 * Pure row-building logic for the Jewish Holidays Calendar Actor. The only import from
 * hebrew-calendar.ts (the sole file that talks to @hebcal/core) is a list of `Event` objects and a
 * few read-only accessors; everything here works with those plus src/lib/hebrew.ts formatting.
 */
import {
  MONTH_ADAR_I,
  MONTH_ADAR_II,
  MONTH_TEVET,
  MONTH_TISHREI,
  formatHebrewDateEn,
  formatHebrewDateHe,
  hebrewMonthNameEn,
  isHebrewLeapYear,
} from './hebrew.js';
import {
  type Event,
  daysInHebrewYear,
  eventHebrewDate,
  eventIsoDate,
  hebrewDateOfGregorian,
  yearEvents,
} from './hebrew-calendar.js';

// Months not already named in hebrew.ts (kept local: hebrew.ts is copied verbatim across Actors).
const MONTH_TAMUZ = 4;
const MONTH_AV = 5;

export type IncludeCategory = 'major' | 'minor' | 'fasts' | 'roshChodesh' | 'modern' | 'omer' | 'parasha' | 'specialShabbat';
export const INCLUDE_CATEGORIES: readonly IncludeCategory[] = ['major', 'minor', 'fasts', 'roshChodesh', 'modern', 'omer', 'parasha', 'specialShabbat'];

export type CalendarLocation = 'israel' | 'diaspora';
export type CalendarLanguage = 'en' | 'he' | 'both';
export type CalendarYearType = 'gregorian' | 'hebrew';

export interface GenerateOptions {
  year: number;
  yearType: CalendarYearType;
  location: CalendarLocation;
  include: readonly IncludeCategory[];
  language: CalendarLanguage;
}

export interface HebrewYearInfo {
  hebrewYear: number;
  isLeapYear: boolean;
  /** Number of days in that Hebrew year (353-355 regular, 383-385 leap). */
  yearLength: number;
}

/** One row per generated calendar day/event, or the single trailing meta row. Every row shares the same keys. */
export interface CalendarRow {
  rowType: 'holiday' | 'meta';
  date: string | null;
  hebrewDate: string | null;
  hebrewDateHe: string | null;
  name: string | null;
  nameHe: string | null;
  category: string | null;
  beginsEveningBefore: boolean | null;
  isYomTov: boolean | null;
  /** Only set (non-null) when `location` is "israel"; null for a diaspora-schedule run. */
  isIsraeliPublicHoliday: boolean | null;
  memo: string | null;
  hebrewYear: number | null;
  isLeapYear: boolean | null;
  /** Only set on the meta row: every distinct Hebrew year touched by the requested calendar. */
  hebrewYearsInRange: HebrewYearInfo[] | null;
}

// Maps this Actor's `include` names to @hebcal/core's own `Event.getCategories()` strings. Hebcal's
// on/off switches (noModern, noMinorFast, ...) bundle categories differently than this list, so every
// category is generated (hebrew-calendar.ts) and filtered here for exact, independent control.
const CATEGORY_MAP: Record<IncludeCategory, string> = {
  major: 'major',
  minor: 'minor',
  fasts: 'fast',
  roshChodesh: 'roshchodesh',
  modern: 'modern',
  omer: 'omer',
  parasha: 'parashat',
  specialShabbat: 'shabbat',
};

// Priority order for the single `category` value shown per row (an event can carry more than one
// Hebcal category, e.g. Chol HaMoed days are both "major" and "cholhamoed").
const CATEGORY_LABEL: readonly (readonly [string, string])[] = [
  ['cholhamoed', 'cholHamoed'],
  ['major', 'major'],
  ['fast', 'fast'],
  ['minor', 'minor'],
  ['modern', 'modern'],
  ['roshchodesh', 'roshChodesh'],
  ['shabbat', 'specialShabbat'],
  ['omer', 'omer'],
  ['parashat', 'parasha'],
];

function primaryCategory(cats: readonly string[]): string {
  for (const [hebcalCat, label] of CATEGORY_LABEL) if (cats.includes(hebcalCat)) return label;
  return cats[0] ?? 'other';
}

/**
 * The nine statutory Israeli public-holiday days (explicit table, per TOP60.md 4.3): Rosh Hashanah
 * (2 days), Yom Kippur, Sukkot I, Shemini Atzeret (combined with Simchat Torah in Israel), Pesach I
 * and VII, Shavuot, Yom HaAtzma'ut. Matched against the Israel-schedule (il=true) English
 * description with any trailing " <year>" suffix stripped (e.g. "Rosh Hashana 5787" -> "Rosh Hashana").
 */
const STATUTORY_IL_HOLIDAYS: ReadonlySet<string> = new Set([
  'Rosh Hashana',
  'Rosh Hashana II',
  'Yom Kippur',
  'Sukkot I',
  'Shmini Atzeret',
  'Pesach I',
  'Pesach VII',
  'Shavuot',
  "Yom HaAtzma'ut",
]);

export function isStatutoryIsraeliHoliday(description: string): boolean {
  return STATUTORY_IL_HOLIDAYS.has(description.replace(/ \d{4}$/, ''));
}

// The "usual" Hebrew day of month-fixed fasts, used only to explain (in `memo`) when the observed
// date differs because the fast was deferred off Shabbat (never brought forward in this calendar).
// Yom Kippur is deliberately excluded: it never moves (always exactly 10 Tishrei).
const NOMINAL_FAST_DAY: Record<string, (leap: boolean) => { month: number; day: number }> = {
  'Tzom Gedaliah': () => ({ month: MONTH_TISHREI, day: 3 }),
  "Asara B'Tevet": () => ({ month: MONTH_TEVET, day: 10 }),
  "Ta'anit Esther": (leap) => ({ month: leap ? MONTH_ADAR_II : MONTH_ADAR_I, day: 13 }),
  "Shiva Asar B'Tamuz": () => ({ month: MONTH_TAMUZ, day: 17 }),
  "Tish'a B'Av": () => ({ month: MONTH_AV, day: 9 }),
};

function fastShiftMemo(description: string, heb: { year: number; month: number; day: number }): string | null {
  const nominalFn = NOMINAL_FAST_DAY[description.replace(/ \d{4}$/, '')];
  if (!nominalFn) return null;
  const nominal = nominalFn(isHebrewLeapYear(heb.year));
  if (nominal.month === heb.month && nominal.day === heb.day) return null;
  return `Deferred from the usual ${nominal.day} ${hebrewMonthNameEn(nominal.month, heb.year)} because that date would fall on Shabbat.`;
}

const wantEn = (l: CalendarLanguage): boolean => l === 'en' || l === 'both';
const wantHe = (l: CalendarLanguage): boolean => l === 'he' || l === 'both';
const HE_NO_NIKUD = 'he-x-NoNikud';

function buildHolidayRow(ev: Event, options: GenerateOptions): CalendarRow {
  const heb = eventHebrewDate(ev);
  const en = wantEn(options.language);
  const he = wantHe(options.language);
  const cats = ev.getCategories?.() ?? [];
  const desc = ev.getDesc();
  return {
    rowType: 'holiday',
    date: eventIsoDate(ev),
    hebrewDate: en ? formatHebrewDateEn(heb) : null,
    hebrewDateHe: he ? formatHebrewDateHe(heb) : null,
    name: en ? desc : null,
    nameHe: he ? ev.render(HE_NO_NIKUD) : null,
    category: primaryCategory(cats),
    beginsEveningBefore: ev.hasAnyFlag('CHAG', 'MAJOR_FAST'),
    isYomTov: ev.hasAnyFlag('CHAG'),
    isIsraeliPublicHoliday: options.location === 'israel' ? isStatutoryIsraeliHoliday(desc) : null,
    memo: fastShiftMemo(desc, heb),
    hebrewYear: heb.year,
    isLeapYear: isHebrewLeapYear(heb.year),
    hebrewYearsInRange: null,
  };
}

function describeHebrewYear(hebrewYear: number): HebrewYearInfo {
  return { hebrewYear, isLeapYear: isHebrewLeapYear(hebrewYear), yearLength: daysInHebrewYear(hebrewYear) };
}

function buildMetaRow(options: GenerateOptions, hebrewYearsInRange: HebrewYearInfo[]): CalendarRow {
  return {
    rowType: 'meta',
    date: null,
    hebrewDate: null,
    hebrewDateHe: null,
    name: 'Year summary',
    nameHe: null,
    category: null,
    beginsEveningBefore: null,
    isYomTov: null,
    isIsraeliPublicHoliday: null,
    memo: `${options.yearType === 'hebrew' ? `Hebrew year ${options.year}` : `Gregorian year ${options.year}`}, location=${options.location}, include=${options.include.join(',') || '(none)'}.`,
    hebrewYear: null,
    isLeapYear: null,
    hebrewYearsInRange,
  };
}

/**
 * Every Hebrew year touched by the requested Gregorian/Hebrew year, independent of `include`
 * (a Gregorian year normally spans the tail of one Hebrew year and the start of the next).
 */
function hebrewYearsInRangeFor(options: GenerateOptions): HebrewYearInfo[] {
  if (options.yearType === 'hebrew') return [describeHebrewYear(options.year)];
  const first = hebrewDateOfGregorian(options.year, 1, 1).year;
  const last = hebrewDateOfGregorian(options.year, 12, 31).year;
  const years = first === last ? [first] : [first, last];
  return years.map(describeHebrewYear);
}

/** Generate the requested holiday rows (sorted by date) plus one trailing meta row. Pure; never throws for valid options. */
export function generateCalendar(options: GenerateOptions): CalendarRow[] {
  const events = yearEvents(options.year, options.yearType === 'hebrew', options.location === 'israel');
  const wanted = new Set(options.include.map((c) => CATEGORY_MAP[c]));
  const rows = events
    .filter((ev) => (ev.getCategories?.() ?? []).some((c) => wanted.has(c)))
    .map((ev) => buildHolidayRow(ev, options))
    .sort((a, b) => (a.date as string).localeCompare(b.date as string) || (a.name ?? '').localeCompare(b.name ?? ''));
  return [...rows, buildMetaRow(options, hebrewYearsInRangeFor(options))];
}
