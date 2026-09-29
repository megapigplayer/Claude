/**
 * Hebrew-calendar anniversaries (birthdays and yahrzeits) with EXPLICIT, reported rules.
 *
 * The date arithmetic follows Reingold & Dershowitz, "Calendrical Calculations" (birthday rule
 * p. 111, yahrzeit rule p. 113) - the same rules Hebcal implements. The tests compare this code
 * with Hebcal's `getBirthdayOrAnniversary` / `getYahrzeit` for every date of 100+ Hebrew years.
 * Unlike the library call, every result here carries a `ruleCode` and a plain-English sentence, so
 * a caller can see WHEN a special rule fired (30 Cheshvan / 30 Kislev / Adar I / Adar II).
 *
 * CUSTOMS DIFFER. Communities disagree about some of these dates (most famously: in which Adar of
 * a leap year a death or birth in a regular year's Adar is observed, and what to do with 30
 * Cheshvan / 30 Kislev / 30 Adar I). The defaults below are the Reingold-Dershowitz rules. The only
 * community-dependent choice that is configurable is `AdarRule`.
 * VERIFY: whether "default" (birthday -> Adar II, yahrzeit -> Adar I) matches the audience's custom
 * was NOT verified against halachic sources; the README tells users to consult their rabbi.
 */
import {
  type HebrewDate,
  MONTH_ADAR_I,
  MONTH_ADAR_II,
  MONTH_CHESHVAN,
  MONTH_KISLEV,
  MONTH_NISAN,
  MONTH_SHVAT,
  MONTH_TEVET,
  hebrewMonthNameEn,
  isHebrewLeapYear,
} from './hebrew.js';
import { hebrewToRd, isLongCheshvan, isShortKislev, rdToHebrew } from './hebrew-calendar.js';

export type AnniversaryType = 'birthday' | 'yahrzeit';

/**
 * Which Adar a date in the (single) Adar of a regular year moves to in a leap year.
 * `default` = Reingold-Dershowitz: birthdays -> Adar II, yahrzeits -> Adar I.
 */
export type AdarRule = 'default' | 'adar-i' | 'adar-ii';

export type RuleCode =
  | 'SAME_DATE'
  | 'ADAR_TO_ADAR_I'
  | 'ADAR_TO_ADAR_II'
  | 'ADAR_I_TO_ADAR'
  | 'ADAR_II_TO_ADAR'
  | 'ADAR_I_30_TO_NISAN_1'
  | 'ADAR_I_30_TO_SHVAT_30'
  | 'CHESHVAN_30_TO_KISLEV_1'
  | 'KISLEV_30_TO_TEVET_1'
  | 'DAY_BEFORE_KISLEV_1'
  | 'DAY_BEFORE_TEVET_1';

export interface AnniversaryResult {
  date: HebrewDate;
  ruleCode: RuleCode;
}

/** Anniversary of `orig` in Hebrew year `hyear` (> orig.year), or null when hyear is not after the original year. */
export function anniversaryInYear(orig: HebrewDate, hyear: number, type: AnniversaryType, adarRule: AdarRule = 'default'): AnniversaryResult | null {
  if (hyear <= orig.year) return null;
  return type === 'birthday' ? birthdayInYear(orig, hyear, adarRule) : yahrzeitInYear(orig, hyear, adarRule);
}

/** Month that a regular-year Adar date takes in a leap year, for the given rule set. */
function leapYearAdarMonth(type: AnniversaryType, adarRule: AdarRule): { month: number; code: RuleCode } {
  const target = adarRule === 'default' ? (type === 'birthday' ? 'adar-ii' : 'adar-i') : adarRule;
  return target === 'adar-ii' ? { month: MONTH_ADAR_II, code: 'ADAR_TO_ADAR_II' } : { month: MONTH_ADAR_I, code: 'ADAR_TO_ADAR_I' };
}

function birthdayInYear(orig: HebrewDate, hyear: number, adarRule: AdarRule): AnniversaryResult {
  const origLeap = isHebrewLeapYear(orig.year);
  const targetLeap = isHebrewLeapYear(hyear);
  let month = orig.month;
  let day = orig.day;
  let ruleCode: RuleCode = 'SAME_DATE';

  if (month === MONTH_ADAR_I && !origLeap) {
    // Born in the single Adar of a regular year.
    if (targetLeap) {
      const pick = leapYearAdarMonth('birthday', adarRule);
      month = pick.month;
      ruleCode = pick.code;
    }
  } else if (month === MONTH_ADAR_II) {
    // Born in Adar II (only exists in leap years): always the LAST month of the target year.
    if (!targetLeap) {
      month = MONTH_ADAR_I;
      ruleCode = 'ADAR_II_TO_ADAR';
    }
  } else if (month === MONTH_CHESHVAN && day === 30 && !isLongCheshvan(hyear)) {
    month = MONTH_KISLEV;
    day = 1;
    ruleCode = 'CHESHVAN_30_TO_KISLEV_1';
  } else if (month === MONTH_KISLEV && day === 30 && isShortKislev(hyear)) {
    month = MONTH_TEVET;
    day = 1;
    ruleCode = 'KISLEV_30_TO_TEVET_1';
  } else if (month === MONTH_ADAR_I && origLeap) {
    // Born in Adar I of a leap year.
    if (!targetLeap) {
      if (day === 30) {
        month = MONTH_NISAN;
        day = 1;
        ruleCode = 'ADAR_I_30_TO_NISAN_1';
      } else {
        ruleCode = 'ADAR_I_TO_ADAR';
      }
    }
  }
  return { date: { year: hyear, month, day }, ruleCode };
}

function yahrzeitInYear(orig: HebrewDate, hyear: number, adarRule: AdarRule): AnniversaryResult {
  const origLeap = isHebrewLeapYear(orig.year);
  const targetLeap = isHebrewLeapYear(hyear);
  const firstAnniversaryYear = orig.year + 1;
  let month = orig.month;
  let day = orig.day;
  let ruleCode: RuleCode = 'SAME_DATE';

  if (month === MONTH_CHESHVAN && day === 30 && !isLongCheshvan(firstAnniversaryYear)) {
    // 30 Cheshvan did not occur on the first anniversary: from then on use "the day before 1 Kislev".
    const date = rdToHebrew(hebrewToRd({ year: hyear, month: MONTH_KISLEV, day: 1 }) - 1);
    return { date, ruleCode: 'DAY_BEFORE_KISLEV_1' };
  }
  if (month === MONTH_KISLEV && day === 30 && isShortKislev(firstAnniversaryYear)) {
    const date = rdToHebrew(hebrewToRd({ year: hyear, month: MONTH_TEVET, day: 1 }) - 1);
    return { date, ruleCode: 'DAY_BEFORE_TEVET_1' };
  }

  if (month === MONTH_ADAR_II) {
    if (!targetLeap) {
      month = MONTH_ADAR_I;
      ruleCode = 'ADAR_II_TO_ADAR';
    }
  } else if (month === MONTH_ADAR_I && !origLeap) {
    // Died in the single Adar of a regular year.
    if (targetLeap) {
      const pick = leapYearAdarMonth('yahrzeit', adarRule);
      month = pick.month;
      ruleCode = pick.code;
    }
  } else if (month === MONTH_ADAR_I && origLeap) {
    if (!targetLeap) {
      if (day === 30) {
        month = MONTH_SHVAT;
        day = 30;
        ruleCode = 'ADAR_I_30_TO_SHVAT_30';
      } else {
        ruleCode = 'ADAR_I_TO_ADAR';
      }
    }
  }

  // "Advance to Rosh Chodesh if the day does not exist."
  if (month === MONTH_CHESHVAN && day === 30 && !isLongCheshvan(hyear)) {
    month = MONTH_KISLEV;
    day = 1;
    ruleCode = 'CHESHVAN_30_TO_KISLEV_1';
  } else if (month === MONTH_KISLEV && day === 30 && isShortKislev(hyear)) {
    month = MONTH_TEVET;
    day = 1;
    ruleCode = 'KISLEV_30_TO_TEVET_1';
  }
  return { date: { year: hyear, month, day }, ruleCode };
}

/** One-sentence English explanation of a rule code (null for a plain same-date anniversary). */
export function ruleSentence(code: RuleCode, type: AnniversaryType, orig: HebrewDate): string | null {
  const what = type === 'birthday' ? 'birthday' : 'yahrzeit';
  switch (code) {
    case 'SAME_DATE':
      return null;
    case 'ADAR_TO_ADAR_II':
      return `Original date is in Adar of a non-leap year; in a leap year the ${what} is observed in Adar II.`;
    case 'ADAR_TO_ADAR_I':
      return `Original date is in Adar of a non-leap year; in a leap year the ${what} is observed in Adar I.`;
    case 'ADAR_I_TO_ADAR':
      return `Original date is in Adar I of a leap year; in a non-leap year the ${what} is observed in Adar.`;
    case 'ADAR_II_TO_ADAR':
      return `Original date is in Adar II of a leap year; in a non-leap year the ${what} is observed in Adar.`;
    case 'ADAR_I_30_TO_NISAN_1':
      return `Original date is 30 Adar I, which does not exist in a non-leap year; the ${what} moves to 1 Nisan.`;
    case 'ADAR_I_30_TO_SHVAT_30':
      return `Original date is 30 Adar I, which does not exist in a non-leap year; the ${what} is observed on 30 Sh'vat (the day before Rosh Chodesh Adar).`;
    case 'CHESHVAN_30_TO_KISLEV_1':
      return `Original date is 30 ${hebrewMonthNameEn(orig.month, orig.year)}; this year Cheshvan has only 29 days, so the ${what} moves to 1 Kislev.`;
    case 'KISLEV_30_TO_TEVET_1':
      return `Original date is 30 ${hebrewMonthNameEn(orig.month, orig.year)}; this year Kislev has only 29 days, so the ${what} moves to 1 Tevet.`;
    case 'DAY_BEFORE_KISLEV_1':
      return 'Original date is 30 Cheshvan and Cheshvan was short in the first anniversary year, so the yahrzeit is kept on the day before Rosh Chodesh Kislev (29 or 30 Cheshvan).';
    case 'DAY_BEFORE_TEVET_1':
      return 'Original date is 30 Kislev and Kislev was short in the first anniversary year, so the yahrzeit is kept on the day before Rosh Chodesh Tevet (29 or 30 Kislev).';
    default:
      return null;
  }
}

/**
 * Standing note about how an original date is treated (independent of the years listed), or null
 * when the date has no special rule (every month/day except 30 Cheshvan, 30 Kislev and any Adar).
 */
export function standingRuleNote(orig: HebrewDate, type: AnniversaryType, adarRule: AdarRule): string | null {
  const what = type === 'birthday' ? 'birthday' : 'yahrzeit';
  const leap = isHebrewLeapYear(orig.year);
  if (orig.month === MONTH_CHESHVAN && orig.day === 30) {
    return type === 'birthday'
      ? 'Born on 30 Cheshvan: in years when Cheshvan has 29 days the birthday moves to 1 Kislev (Reingold-Dershowitz).'
      : 'Died on 30 Cheshvan: if Cheshvan is short in the first anniversary year the yahrzeit is kept on the day before 1 Kislev in every year, otherwise on 30 Cheshvan (1 Kislev when Cheshvan is short) (Reingold-Dershowitz).';
  }
  if (orig.month === MONTH_KISLEV && orig.day === 30) {
    return type === 'birthday'
      ? 'Born on 30 Kislev: in years when Kislev has 29 days the birthday moves to 1 Tevet (Reingold-Dershowitz).'
      : 'Died on 30 Kislev: if Kislev is short in the first anniversary year the yahrzeit is kept on the day before 1 Tevet in every year, otherwise on 30 Kislev (1 Tevet when Kislev is short) (Reingold-Dershowitz).';
  }
  if (orig.month === MONTH_ADAR_I && !leap) {
    const pick = leapYearAdarMonth(type, adarRule);
    const adar = pick.month === MONTH_ADAR_II ? 'Adar II' : 'Adar I';
    const custom = adarRule === 'default' ? 'Reingold-Dershowitz default' : `your adarRule="${adarRule}"`;
    return `${what[0]?.toUpperCase()}${what.slice(1)} in Adar of a non-leap year: in a leap year it is observed in ${adar} (${custom}); communities differ on this, ask your rabbi.`;
  }
  if (orig.month === MONTH_ADAR_I && leap) {
    return orig.day === 30
      ? `${what[0]?.toUpperCase()}${what.slice(1)} on 30 Adar I: in a non-leap year it is observed on ${type === 'birthday' ? '1 Nisan' : '30 Sh\'vat'} (Reingold-Dershowitz); in a leap year on 30 Adar I. Communities differ.`
      : `${what[0]?.toUpperCase()}${what.slice(1)} in Adar I: in leap years Adar I, in non-leap years Adar.`;
  }
  if (orig.month === MONTH_ADAR_II) {
    return `${what[0]?.toUpperCase()}${what.slice(1)} in Adar II: in leap years Adar II, in non-leap years Adar.`;
  }
  return null;
}

/** Highest Hebrew year the underlying calendar supports for anniversaries. */
export const MAX_HEBREW_YEAR = 9999;

