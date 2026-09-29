import { describe, expect, it } from 'vitest';
import { MAX_ABS_AMOUNT, parseAmount, toIls } from '../src/lib/convert.js';
import { mulberry32 } from './helpers.js';

describe('parseAmount', () => {
  it('accepts numbers and plain numeric strings', () => {
    expect(parseAmount(1200)).toEqual({ ok: true, value: 1200 });
    expect(parseAmount(0)).toEqual({ ok: true, value: 0 });
    expect(parseAmount(-45.5)).toEqual({ ok: true, value: -45.5 });
    expect(parseAmount('1234.56')).toEqual({ ok: true, value: 1234.56 });
    expect(parseAmount(' 1 234.56 ')).toEqual({ ok: true, value: 1234.56 });
    expect(parseAmount('1,234.56')).toEqual({ ok: true, value: 1234.56 });
    expect(parseAmount('1,234,567')).toEqual({ ok: true, value: 1234567 });
    expect(parseAmount('-0.5')).toEqual({ ok: true, value: -0.5 });
    expect(parseAmount('+7')).toEqual({ ok: true, value: 7 });
    expect(parseAmount('.5')).toEqual({ ok: true, value: 0.5 });
  });

  it('never returns negative zero', () => {
    const r = parseAmount(-0);
    expect(r.ok && Object.is(r.value, 0)).toBe(true);
  });

  it('rejects anything that is not clearly a number', () => {
    for (const bad of ['', 'abc', '12abc', '1.234,56', '1,23', '1,2345', '$100', '1e3', '--1', '1..2', 'NaN', 'Infinity']) {
      expect(parseAmount(bad).ok, bad).toBe(false);
    }
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}, [], true]) expect(parseAmount(bad).ok).toBe(false);
    expect(parseAmount(MAX_ABS_AMOUNT * 10).ok).toBe(false);
  });
});

describe('toIls', () => {
  it('converts at the published rate and rounds to agorot', () => {
    expect(toIls(1200, 3.648, 1)).toBe(4377.6);
    expect(toIls(1234.56, 3.646, 1)).toBe(4501.21); // 4501.20576
    expect(toIls(100, 3.647, 1)).toBe(364.7);
    expect(toIls(0, 3.647, 1)).toBe(0);
  });

  it('respects the quotation unit (JPY per 100, LBP per 10)', () => {
    expect(toIls(10_000, 2.3456, 100)).toBe(234.56);
    expect(toIls(1, 2.3456, 100)).toBe(0.02);
    expect(toIls(100_000, 0.0036, 10)).toBe(36);
  });

  it('rounds half up (away from zero for negatives), with no binary floating point noise', () => {
    expect(toIls(0.5, 0.01, 1)).toBe(0.01); // 0.005 -> 0.01
    expect(toIls(-0.5, 0.01, 1)).toBe(-0.01);
    expect(toIls(1.005, 1, 1)).toBe(1.01); // 1.005 is 1.00499999999999989... as a float; decimal maths gets it right
    expect(toIls(0.145, 1, 1)).toBe(0.15);
    expect(toIls(-1200, 3.648, 1)).toBe(-4377.6);
    expect(Object.is(toIls(-0.001, 1, 1), 0)).toBe(true); // rounds to zero, never -0
  });

  it('matches an independent exact big-integer oracle for random inputs', () => {
    const rnd = mulberry32(2025);
    for (let i = 0; i < 2000; i++) {
      const cents = BigInt(Math.floor(rnd() * 2_000_000_000)) * (rnd() < 0.3 ? -1n : 1n); // amount in cents
      const rate4 = BigInt(1 + Math.floor(rnd() * 90_000)); // rate with 4 decimals, up to 9.0000
      const unit = [1, 10, 100][Math.floor(rnd() * 3)] as number;
      const amount = Number(cents) / 100;
      const rate = Number(rate4) / 10_000;
      // agorot = cents * rate4 / (10^4 * unit), rounded half away from zero
      const abs = cents < 0n ? -cents : cents;
      const num = abs * rate4;
      const den = 10_000n * BigInt(unit);
      let agorot = num / den;
      if (2n * (num % den) >= den) agorot += 1n;
      const expected = Number(cents < 0n ? -agorot : agorot) / 100;
      expect(toIls(amount, rate, unit), `${amount} x ${rate} / ${unit}`).toBe(Object.is(expected, -0) ? 0 : expected);
    }
  });
});
