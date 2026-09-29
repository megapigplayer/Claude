/**
 * Israeli phone numbers via libphonenumber-js (MIT), region IL, "max" metadata (needed for the number type).
 *
 * The library validates against Israel's numbering plan (allocated prefix ranges), not just the length:
 * for example 050-1234567 has the right length but is reported as not valid, exactly like other
 * libphonenumber-based tools. The plan can change; the pinned library version is the reference.
 *
 * Accepted shapes when `normalize` is on: 050-123-4567, 0501234567, 050 123 4567, +972-50-123-4567,
 * 972501234567, 00972501234567, +972 (0)50 123 4567 (trunk zero), a trailing extension ("ext 12"),
 * landlines (02/03/04/08/09), VoIP (07x), 1-700 / 1-800 / 1-900 numbers. Without a trunk zero (501234567)
 * the number is still understood as Israeli.
 */
import { parsePhoneNumberFromString, validatePhoneNumberLength } from 'libphonenumber-js/max';
import { firstDisallowed } from './text.js';
import type { ReasonCode, TypeCheck, WarningCode } from './types.js';

const REGION = 'IL';

/** libphonenumber type names -> the lower-case kebab names used in the output. */
const TYPE_NAMES: Readonly<Record<string, string>> = {
  MOBILE: 'mobile',
  FIXED_LINE: 'fixed-line',
  FIXED_LINE_OR_MOBILE: 'fixed-line-or-mobile',
  TOLL_FREE: 'toll-free',
  PREMIUM_RATE: 'premium-rate',
  SHARED_COST: 'shared-cost',
  VOIP: 'voip',
  PERSONAL_NUMBER: 'personal-number',
  PAGER: 'pager',
  UAN: 'uan',
  VOICEMAIL: 'voicemail',
};

/** Characters a phone cell may contain besides digits (extension text is split off first). */
const ALLOWED_CHARS = /[0-9+()\s.\-/\p{Pd}]/u;
/** Optional trailing extension: "ext 12", "ext. 12", "x12", "#12", "extension 12", Hebrew "שלוחה 12". */
const EXTENSION = /^(.*?)[\s,;]*(?:ext\.?|extension|x|#|שלוחה)\s*[:.]?\s*(\d{1,6})\s*$/iu;

function fail(reasonCode: Exclude<ReasonCode, 'OK'>, reason: string, warnings: WarningCode[] = []): TypeCheck {
  return { valid: false, reasonCode, reason, normalized: null, details: null, warnings };
}

/**
 * Digits after the country code / trunk zero that Israeli numbers starting with this digit have: mobile 05x and
 * VoIP 07x = 9, landlines 02/03/04/08/09 = 8. libphonenumber's generic "possible length" for Israel spans 7-12
 * digits (special 1-xxx numbers), which would call a mobile number with one digit too many "plausible".
 */
function expectedNationalLength(nationalNumber: string): { length: number; kind: string } | null {
  const first = nationalNumber.charAt(0);
  if (first === '5') return { length: 9, kind: 'mobile' };
  if (first === '7') return { length: 9, kind: 'VoIP' };
  if ('23489'.includes(first)) return { length: 8, kind: 'landline' };
  return null;
}

/** Splits a trailing extension ("03-1234567 ext 12") off a phone cell. */
export function splitExtension(text: string): { body: string; extension: string | null } {
  const m = EXTENSION.exec(text);
  return m ? { body: m[1] ?? '', extension: m[2] ?? null } : { body: text, extension: null };
}

export function checkIsraeliPhone(text: string, normalize: boolean): TypeCheck {
  if (text === '') return fail('EMPTY', 'Nothing to check.');

  if (!normalize) {
    // Strict mode: the canonical form only, E.164 ("+972501234567").
    if (!/^\+\d+$/.test(text)) {
      return fail('BAD_FORMAT', 'Strict mode (normalize = false) requires E.164 form: "+" followed by digits only, e.g. "+972501234567".');
    }
  }

  let body = text;
  let extension: string | null = null;
  if (normalize) {
    ({ body, extension } = splitExtension(text));
    const badChar = firstDisallowed(body, ALLOWED_CHARS);
    if (badChar !== null) {
      return fail('INVALID_CHARACTERS', `Contains the invalid character ${badChar}; a phone number has digits, an optional leading "+", and separators (spaces, dashes, dots, brackets).`);
    }
  }
  if (body.trim() === '') return fail('EMPTY', 'Nothing left to check after removing the extension.');

  const parsed = parsePhoneNumberFromString(body, REGION);
  if (!parsed) {
    const lengthProblem = validatePhoneNumberLength(body, REGION);
    if (lengthProblem === 'TOO_SHORT' || lengthProblem === 'TOO_LONG' || lengthProblem === 'INVALID_LENGTH') {
      return fail('WRONG_LENGTH', `The number has the wrong number of digits for an Israeli number (${lengthProblem === 'TOO_SHORT' ? 'too short' : lengthProblem === 'TOO_LONG' ? 'too long' : 'not a valid length'}).`);
    }
    return fail('BAD_FORMAT', 'Could not be read as a phone number.');
  }

  const country = parsed.country ?? null;
  if (!parsed.isValid()) {
    if (country !== null && country !== REGION) {
      return fail('BAD_FORMAT', `Not a valid phone number (read as region ${country}); Israeli numbers start with 0, +972 or 972.`);
    }
    const expected = expectedNationalLength(parsed.nationalNumber);
    if (expected !== null && parsed.nationalNumber.length !== expected.length) {
      return fail(
        'WRONG_LENGTH',
        `The number has ${parsed.nationalNumber.length} digits after the country code / leading 0, but Israeli ${expected.kind} numbers have ${expected.length}.`,
      );
    }
    if (!parsed.isPossible()) {
      return fail('WRONG_LENGTH', 'The number has the wrong number of digits for an Israeli number.');
    }
    return fail(
      'BAD_FORMAT',
      'The length is plausible, but the prefix is not in the Israeli numbering plan (unallocated range), so the number is not valid.',
    );
  }
  if (country !== REGION) {
    return fail('NOT_ISRAELI', `A valid phone number, but for region ${country ?? 'unknown'}, not Israel (IL).`);
  }

  if (!normalize && parsed.number !== text) {
    return fail('BAD_FORMAT', `Strict mode (normalize = false) requires the canonical E.164 form; this number would be "${parsed.number}".`);
  }

  const warnings: WarningCode[] = [];
  const ext = extension ?? parsed.ext ?? null;
  if (ext) warnings.push('EXTENSION_IGNORED');
  const type = parsed.getType();
  return {
    valid: true,
    reasonCode: 'OK',
    reason: `Valid Israeli phone number (${type ? (TYPE_NAMES[type] ?? type.toLowerCase()) : 'type unknown'}).`,
    normalized: parsed.number,
    details: {
      e164: parsed.number,
      international: parsed.formatInternational(),
      national: parsed.formatNational(),
      region: REGION,
      phoneType: type ? (TYPE_NAMES[type] ?? type.toLowerCase()) : null,
      extension: ext,
    },
    warnings,
  };
}
