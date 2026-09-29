/**
 * Weekend shape + business/half-day classification for one calendar day, per `calendarProfile`.
 * Pure (the only @hebcal/core-derived facts it uses come through hebrew-calendar.ts's lookups).
 */
import { formatCivil, isoFromRd, rdToCivil, weekdayOfRd } from './civil.js';
import type { NamedHoliday } from './hebrew-calendar.js';
import { erevOn, statutoryHolidayOn } from './hebrew-calendar.js';
import { TASE_MON_FRI_SWITCH } from './tase-profile.js';

export type CalendarProfile = 'il-workweek-sun-thu' | 'il-tase-mon-fri' | 'iso-mon-fri' | 'custom';
export const CALENDAR_PROFILES: readonly CalendarProfile[] = ['il-workweek-sun-thu', 'il-tase-mon-fri', 'iso-mon-fri', 'custom'];

export interface ProfileOptions {
  profile: CalendarProfile;
  /** Only meaningful for profile "custom": weekday numbers (0=Sun..6=Sat) treated as weekend. Defaults to [5,6] (Fri/Sat) when not given. */
  customWeekendDays: readonly number[] | null;
  /** ISO dates (YYYY-MM-DD) that always block a business day, in every profile, in addition to any built-in holiday set. */
  extraHolidays: ReadonlySet<string>;
  /** Whether a half business day (Erev-chag, or TASE's early Friday close) still counts as a business day. Default true. */
  halfDaysAreBusiness: boolean;
}

export interface DayClassification {
  iso: string;
  weekday: number;
  isWeekend: boolean;
  holiday: NamedHoliday | null;
  isExtraHoliday: boolean;
  isHalfDay: boolean;
  /** Bilingual reason(s) for the half day (Erev-chag and/or TASE's early Friday close), or null. */
  halfDayReason: NamedHoliday | null;
  isBusinessDay: boolean;
}

const IL_WEEKEND = new Set([5, 6]); // Friday, Saturday
const ISO_WEEKEND = new Set([0, 6]); // Sunday, Saturday

function isOnOrAfterTaseSwitch(iso: string): boolean {
  return iso >= TASE_MON_FRI_SWITCH.value;
}

function weekendSetFor(profile: CalendarProfile, iso: string, customWeekendDays: readonly number[] | null): ReadonlySet<number> {
  switch (profile) {
    case 'il-workweek-sun-thu':
      return IL_WEEKEND;
    case 'il-tase-mon-fri':
      // VERIFY (tase-profile.ts): before the (unconfirmed) switch date, TASE followed the ordinary
      // Israeli Sun-Thu workweek; from it, Mon-Fri trading (weekend Saturday+Sunday).
      return isOnOrAfterTaseSwitch(iso) ? ISO_WEEKEND : IL_WEEKEND;
    case 'iso-mon-fri':
      return ISO_WEEKEND;
    case 'custom':
      return new Set(customWeekendDays && customWeekendDays.length > 0 ? customWeekendDays : [5, 6]);
  }
}

/** Classify one civil day (as an R.D. number) under the given profile/options. Never throws. */
export function classifyDay(rd: number, options: ProfileOptions): DayClassification {
  const iso = isoFromRd(rd);
  const weekday = weekdayOfRd(rd);
  const isWeekend = weekendSetFor(options.profile, iso, options.customWeekendDays).has(weekday);

  const useIsraeliHolidays = options.profile !== 'iso-mon-fri';
  const holiday = useIsraeliHolidays ? statutoryHolidayOn(iso) : null;
  const isExtraHoliday = options.extraHolidays.has(iso);

  const erevOf = useIsraeliHolidays ? erevOn(iso) : null;
  const isTaseFriday = options.profile === 'il-tase-mon-fri' && isOnOrAfterTaseSwitch(iso) && weekday === 5;
  let halfDayReason: NamedHoliday | null = null;
  if (erevOf && isTaseFriday) {
    halfDayReason = { en: `Erev ${erevOf.en}; TASE Friday early close (14:00)`, he: `ערב ${erevOf.he}; סגירה מוקדמת ביום שישי בבורסה (14:00)` };
  } else if (erevOf) {
    halfDayReason = { en: `Erev ${erevOf.en}`, he: `ערב ${erevOf.he}` };
  } else if (isTaseFriday) {
    halfDayReason = { en: 'TASE Friday early close (14:00)', he: 'סגירה מוקדמת ביום שישי בבורסה (14:00)' };
  }
  const isHalfDay = halfDayReason !== null;

  let blocked = isWeekend || holiday !== null || isExtraHoliday;
  if (isHalfDay && !options.halfDaysAreBusiness) blocked = true;

  return {
    iso,
    weekday,
    isWeekend,
    holiday,
    isExtraHoliday,
    isHalfDay,
    halfDayReason,
    isBusinessDay: !blocked,
  };
}

export function civilDateString(rd: number): string {
  return formatCivil(rdToCivil(rd));
}
