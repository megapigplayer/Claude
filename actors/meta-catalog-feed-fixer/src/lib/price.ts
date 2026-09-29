/**
 * Price parsing and normalisation to Meta's "9.99 USD" format (pure).
 *
 * Only syntax is repaired: digits are never rounded, invented or reordered. Every case where the
 * meaning of the text is not certain (ambiguous separator such as "1.299", ambiguous symbol such as "$"
 * without a matching defaults.currency, ranges, several numbers, unknown words) is returned as a
 * failure with a code and a human-readable reason.
 */
import { AMBIGUOUS_SYMBOLS, CURRENCY_TOKENS, ISO_4217, MINOR_UNITS_THREE, MINOR_UNITS_ZERO } from './spec.js';

const ISO = new Set<string>(ISO_4217);
const ZERO_DECIMALS = new Set<string>(MINOR_UNITS_ZERO);
const THREE_DECIMALS = new Set<string>(MINOR_UNITS_THREE);

/** Compact key of a currency token: lower case, no spaces, dots, commas or quotes ("ש\"ח" -> "שח"). */
export function tokenKey(token: string): string {
  return token.normalize('NFKC').toLowerCase().replace(/[\s.,"'׳״’`]+/gu, '');
}

const TOKEN_TO_CODE = new Map<string, string>();
for (const [code, tokens] of Object.entries(CURRENCY_TOKENS)) for (const t of tokens) TOKEN_TO_CODE.set(tokenKey(t), code);
const AMBIGUOUS = new Map<string, readonly string[]>();
for (const [symbol, codes] of Object.entries(AMBIGUOUS_SYMBOLS)) AMBIGUOUS.set(tokenKey(symbol), codes);

export function isIsoCurrency(code: string): boolean {
  return ISO.has(code);
}

/** Number of decimals of the currency (ISO 4217 minor units: 0, 2 or 3). */
export function minorUnits(code: string): number {
  if (ZERO_DECIMALS.has(code)) return 0;
  if (THREE_DECIMALS.has(code)) return 3;
  return 2;
}

export type PriceFailCode =
  | 'EMPTY'
  | 'NO_NUMBER'
  | 'RANGE'
  | 'MULTIPLE_NUMBERS'
  | 'NEGATIVE'
  | 'AMBIGUOUS_NUMBER'
  | 'BAD_NUMBER'
  | 'MISSING_CURRENCY'
  | 'AMBIGUOUS_CURRENCY_SYMBOL'
  | 'UNKNOWN_CURRENCY'
  | 'CURRENCY_CONFLICT';

export interface PriceOk {
  ok: true;
  /** Canonical decimal string, "." as decimal separator, no grouping ("1299.90"). */
  amount: string;
  currency: string;
  /** "1299.90 USD" */
  normalized: string;
  currencyFrom: 'code' | 'symbol' | 'default';
  /** What was normalised, for the change message (empty when the input already was canonical). */
  notes: string[];
  /** Non-fatal observations. */
  warnings: string[];
}

export interface PriceFail {
  ok: false;
  code: PriceFailCode;
  message: string;
}

export type PriceResult = PriceOk | PriceFail;

const fail = (code: PriceFailCode, message: string): PriceFail => ({ ok: false, code, message });

export interface PriceOptions {
  /** ISO code used when the price has no currency or only an ambiguous symbol that fits it. */
  defaultCurrency?: string | undefined;
}

function asciiDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

interface NumberOk {
  ok: true;
  integer: string;
  decimals: string;
  notes: string[];
  warnings: string[];
}

function validateGroups(runs: string[], groupChar: string): boolean {
  if (runs.length <= 1) return true;
  const first = runs[0] as string;
  if (first.length < 1 || first.length > 3) return false;
  const rest = runs.slice(1);
  if (rest.every((r) => r.length === 3)) return true;
  // Indian grouping 1,29,999 (comma only): groups of 2, last group of 3
  if (groupChar === ',' && first.length <= 2 && rest.slice(0, -1).every((r) => r.length === 2) && (rest[rest.length - 1] as string).length === 3) return true;
  return false;
}

function normalizeNumber(core: string, minor: number): NumberOk | PriceFail {
  const notes: string[] = [];
  const warnings: string[] = [];
  const runs = core.split(/[.,'’ ]/u);
  const seps = core.match(/[.,'’ ]/gu) ?? [];
  if (runs.some((r) => r === '')) return fail('BAD_NUMBER', `"${core}" is not a valid number (misplaced separator)`);

  // Which separator, if any, is the decimal separator? (index into seps, -1 = none)
  let decimalIdx = -1;
  const last = seps[seps.length - 1];
  if (last === '.' || last === ',') {
    const sameCount = seps.filter((x) => x === last).length;
    const otherDotComma = seps.some((x) => (x === '.' || x === ',') && x !== last);
    if (sameCount === 1) {
      if (otherDotComma) {
        decimalIdx = seps.length - 1; // "1,299.90" / "1.299,90": the last one is the decimal separator
      } else {
        const after = runs[runs.length - 1] as string;
        const before = runs.slice(0, -1);
        const head = before[0] as string;
        if (after.length !== 3) decimalIdx = seps.length - 1; // "12,50" "12.5" "12,5000"
        else if (before.length !== 1 || /^0+$/.test(head)) decimalIdx = seps.length - 1; // "1 299,500" "0,999"
        else if (last === ',' && head.length <= 3) warnings.push(`"${core}" was read as ${head}${after} (comma as thousands separator)`); // "1,299"
        else if (minor === 3) decimalIdx = seps.length - 1; // 3-decimal currencies: "1.299"
        else return fail('AMBIGUOUS_NUMBER', `"${core}" is ambiguous: the "${last}" could be a thousands or a decimal separator. Write the amount as 1299.00`);
      }
    }
  }
  const intRuns = decimalIdx >= 0 ? runs.slice(0, decimalIdx + 1) : runs;
  const decimalsRaw = decimalIdx >= 0 ? (runs[decimalIdx + 1] as string) : '';
  const groupSeps = seps.slice(0, intRuns.length - 1);
  if (new Set(groupSeps.map((g) => (g === '’' ? "'" : g))).size > 1) return fail('BAD_NUMBER', `"${core}" mixes different thousands separators`);
  if (!validateGroups(intRuns, groupSeps[0] ?? '')) return fail('BAD_NUMBER', `"${core}" has an unusual digit grouping`);

  const joined = intRuns.join('');
  const integer = joined.length > 1 ? joined.replace(/^0+(?=\d)/, '') : joined;
  if (decimalIdx >= 0 && seps[decimalIdx] === ',') notes.push('decimal comma converted to a point');
  if (groupSeps.length > 0) notes.push('thousands separators removed');
  if (integer !== joined) notes.push('leading zeros removed');

  let decimals = decimalsRaw;
  if (decimals.length > minor) {
    const extra = decimals.slice(minor);
    if (/^0+$/.test(extra)) {
      decimals = decimals.slice(0, minor);
      notes.push('trailing zeros trimmed');
    } else {
      warnings.push(`${decimals.length} decimals given but this currency uses ${minor}`);
    }
  }
  return { ok: true, integer, decimals, notes, warnings };
}

/** Parses a price string. See the module comment for the guarantees. */
export function parsePrice(raw: string, options: PriceOptions = {}): PriceResult {
  const original = raw.trim();
  if (original === '') return fail('EMPTY', 'price is empty');
  const s = asciiDigits(original.normalize('NFKC'))
    .replace(/[‎‏‪-‮⁦-⁩؜]/g, '')
    .replace(/−/g, '-');

  const m = /^([^\d\-+]*?)\s*([-+]?)\s*(\d(?:[\d.,'’ ]*\d)?)\s*([^\d]*)$/u.exec(s);
  if (!m) {
    if (!/\d/.test(s)) return fail('NO_NUMBER', `"${original}" contains no number`);
    if (/\d\s*(?:-|–|—|~|to\b|עד)\s*\d/iu.test(s)) return fail('RANGE', `"${original}" is a price range; one exact price is required`);
    return fail('MULTIPLE_NUMBERS', `"${original}" contains more than one number`);
  }
  const pre = (m[1] ?? '').trim();
  const sign = m[2] ?? '';
  const core = m[3] as string;
  const post = (m[4] ?? '').trim();
  if (sign === '-') return fail('NEGATIVE', `"${original}" is negative`);

  // ---- currency -----------------------------------------------------------------------------
  const notes: string[] = [];
  let code: string | null = null;
  let from: PriceOk['currencyFrom'] | null = null;
  let ambiguousKey: string | null = null;
  let ambiguousToken = '';
  for (const token of [pre, post]) {
    if (token === '') continue;
    const key = tokenKey(token);
    let tokenCode: string;
    let tokenFrom: PriceOk['currencyFrom'];
    if (/^[a-z]{3}$/.test(key) && ISO.has(key.toUpperCase())) {
      tokenCode = key.toUpperCase();
      tokenFrom = 'code';
      if (token !== tokenCode) notes.push(`currency code "${token}" written as ${tokenCode}`);
    } else if (TOKEN_TO_CODE.has(key)) {
      tokenCode = TOKEN_TO_CODE.get(key) as string;
      tokenFrom = 'symbol';
      notes.push(`currency "${token}" converted to ${tokenCode}`);
    } else if (AMBIGUOUS.has(key)) {
      if (ambiguousKey !== null && ambiguousKey !== key) return fail('CURRENCY_CONFLICT', `"${original}" has two different currency symbols`);
      ambiguousKey = key;
      ambiguousToken = token;
      continue;
    } else {
      return fail('UNKNOWN_CURRENCY', `unrecognised text "${token}" next to the number in "${original}"`);
    }
    if (code !== null && code !== tokenCode) return fail('CURRENCY_CONFLICT', `"${original}" names two different currencies (${code} and ${tokenCode})`);
    code = tokenCode;
    if (from === null || tokenFrom === 'code') from = tokenFrom;
  }
  const defaultCurrency = options.defaultCurrency;
  if (ambiguousKey !== null) {
    const plausible = AMBIGUOUS.get(ambiguousKey) as readonly string[];
    if (code !== null) {
      if (!plausible.includes(code)) return fail('CURRENCY_CONFLICT', `"${original}": the symbol "${ambiguousToken}" does not fit ${code}`);
    } else if (defaultCurrency !== undefined && plausible.includes(defaultCurrency)) {
      code = defaultCurrency;
      from = 'default';
      notes.push(`symbol "${ambiguousToken}" read as ${defaultCurrency} (defaults.currency)`);
    } else {
      return fail(
        'AMBIGUOUS_CURRENCY_SYMBOL',
        `the symbol "${ambiguousToken}" in "${original}" can mean several currencies (${plausible.slice(0, 4).join(', ')} ...); ` +
          (defaultCurrency ? `defaults.currency ${defaultCurrency} does not fit it` : 'set defaults.currency or write the ISO code (e.g. 9.99 USD)'),
      );
    }
  }
  if (code === null) {
    if (defaultCurrency !== undefined && ISO.has(defaultCurrency)) {
      code = defaultCurrency;
      from = 'default';
      notes.push('currency added from defaults.currency');
    } else {
      return fail('MISSING_CURRENCY', `"${original}" has no currency; write it as 9.99 USD or set defaults.currency`);
    }
  }

  // ---- number -------------------------------------------------------------------------------
  const num = normalizeNumber(core, minorUnits(code));
  if (!num.ok) return num;
  notes.push(...num.notes);
  const amount = num.decimals !== '' ? `${num.integer}.${num.decimals}` : num.integer;
  const warnings = [...num.warnings];
  if (/^0*(?:\.0*)?$/.test(amount)) warnings.push('the price is zero');
  const normalized = `${amount} ${code}`;
  return { ok: true, amount, currency: code, normalized, currencyFrom: from ?? 'code', notes: normalized === original ? [] : notes, warnings };
}

/** Compares two canonical decimal strings ("12", "12.50"): -1, 0 or 1. */
export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  const ai2 = ai.replace(/^0+(?=\d)/, '');
  const bi2 = bi.replace(/^0+(?=\d)/, '');
  if (ai2.length !== bi2.length) return ai2.length < bi2.length ? -1 : 1;
  if (ai2 !== bi2) return ai2 < bi2 ? -1 : 1;
  const len = Math.max(af.length, bf.length);
  const x = af.padEnd(len, '0');
  const y = bf.padEnd(len, '0');
  return x === y ? 0 : x < y ? -1 : 1;
}
