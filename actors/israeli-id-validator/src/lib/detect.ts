/**
 * Type auto-detection for `type = auto`: which of the five types could this value be? Returns the candidate
 * types in priority order (empty = unrecognised). The candidates are then all checked and the first valid one
 * wins; when several are valid the result is flagged `ambiguous`.
 *
 * Shape rules (after separators are removed), documented in the README ("How auto-detection works"):
 *   IL + 2 digits + ...                  -> iban (other 2-letter prefixes with 2 digits and 6+ characters too -> NOT_ISRAELI)
 *   starts with "+"  or  digits + "ext" -> phone
 *   11+ digits starting 972 / 00972      -> phone
 *   10 digits starting 0 or 1            -> phone (mobile 05x, VoIP 07x, 1-700/1-800/1-900)
 *   9 digits starting 0                  -> id, phone (landlines are 0X + 7 digits: same shape as an ID with a leading zero)
 *   9 digits starting 5                  -> company, id
 *   9 digits otherwise                   -> id, company
 *   8 digits                             -> id (leading zero dropped)
 *   7 digits                             -> postcode, id
 *   5-6 digits                           -> id (leading zeros dropped)
 * A bare 9-digit number that starts 1-9 is never treated as a phone number without its trunk zero:
 * a mistyped ID would otherwise be "rescued" as a phone. Use type = phone to check such values.
 */
import { splitExtension } from './phone.js';
import { DASH_CLASS } from './text.js';
import type { ValueType } from './types.js';

const DETECT_SEPARATORS = new RegExp(`[\\s.()/_${DASH_CLASS}]+`, 'gu');

export function detectCandidates(text: string): ValueType[] {
  const { body, extension } = splitExtension(text);
  const compact = body.replace(DETECT_SEPARATORS, '');
  if (compact === '') return [];
  if (extension !== null) return /^\+?\d{7,}$/.test(compact) ? ['phone'] : [];

  if (/^IL\d{2}[A-Z0-9]*$/i.test(compact) || /^[A-Z]{2}\d{2}[A-Z0-9]{6,}$/i.test(compact)) return ['iban'];
  if (compact.startsWith('+')) return /^\+\d+$/.test(compact) ? ['phone'] : [];
  if (!/^\d+$/.test(compact)) return [];

  const n = compact.length;
  const first = compact.charAt(0);
  if (n >= 11 && (compact.startsWith('972') || compact.startsWith('00972'))) return ['phone'];
  if (n === 10 && (first === '0' || first === '1')) return ['phone'];
  if (n === 9) {
    if (first === '0') return ['id', 'phone'];
    return first === '5' ? ['company', 'id'] : ['id', 'company'];
  }
  if (n === 8) return ['id'];
  if (n === 7) return ['postcode', 'id'];
  if (n >= 5 && n <= 6) return ['id'];
  return [];
}
