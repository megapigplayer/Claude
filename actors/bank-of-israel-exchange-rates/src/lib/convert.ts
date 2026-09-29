/**
 * Amount parsing and foreign-currency -> ILS conversion (pure). Uses decimal arithmetic so
 * 1,234.56 x 3.646 never picks up binary floating-point noise, and rounds half-up to agorot
 * (2 decimals) like an invoice would.
 */
import { Decimal } from 'decimal.js';

/** Largest amount accepted: far beyond any invoice, small enough that cent arithmetic stays exact. */
export const MAX_ABS_AMOUNT = 1e15;

export type AmountParse = { ok: true; value: number } | { ok: false; reason: string };

export function parseAmount(raw: unknown): AmountParse {
  let value: number;
  if (typeof raw === 'number') {
    value = raw;
  } else if (typeof raw === 'string') {
    const text = raw.replace(/[\s ]/g, '');
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) value = Number(text.replace(/,/g, ''));
    else if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(text)) value = Number(text);
    else {
      return {
        ok: false,
        reason: `"${raw}" is not a plain number (write 1234.56, optionally with comma thousands separators such as 1,234.56)`,
      };
    }
  } else {
    return { ok: false, reason: 'the amount must be a number' };
  }
  if (!Number.isFinite(value)) return { ok: false, reason: 'the amount must be a finite number' };
  if (Math.abs(value) > MAX_ABS_AMOUNT) return { ok: false, reason: `the amount is larger than ${MAX_ABS_AMOUNT}` };
  return { ok: true, value: Object.is(value, -0) ? 0 : value };
}

/**
 * `amount` foreign units -> ILS at `rate` (ILS per `unit` foreign units), rounded half-up to 2 decimals.
 * Example: 10,000 JPY at 2.3456 per 100 JPY -> 234.56 ILS.
 */
export function toIls(amount: number, rate: number, unit: number): number {
  const result = new Decimal(amount).times(rate).div(unit).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  return Object.is(result, -0) ? 0 : result;
}
