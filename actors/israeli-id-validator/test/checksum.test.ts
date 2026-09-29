import { describe, expect, it } from 'vitest';
import {
  checkDigitFor,
  hasValidChecksum,
  isRepeatedDigits,
  isRepeatedWithCheckDigit,
  isSequentialDigits,
  looksLikePlaceholder,
  mod97,
  WELL_KNOWN_TEST_NUMBERS,
} from '../src/lib/checksum.js';
import { luhnValid, mulberry32, randomDigits, withCheckDigit } from './helpers.js';

describe('Israeli check digit (golden values)', () => {
  it('123456782 is valid: the check digit for 12345678 is 2', () => {
    expect(checkDigitFor('12345678')).toBe(2);
    expect(hasValidChecksum('123456782')).toBe(true);
  });

  it('123456789 is invalid (the check digit would have to be 2)', () => {
    expect(hasValidChecksum('123456789')).toBe(false);
  });

  it.each([
    ['12345678', 2],
    ['01234567', 4],
    ['03456789', 1],
    ['31415926', 0],
    ['27182818', 8],
    ['51000000', 3],
    ['52000000', 1],
    ['58000000', 8],
    ['00000001', 8],
    ['00000000', 0],
  ])('check digit for %s is %i', (first8, expected) => {
    expect(checkDigitFor(first8)).toBe(expected);
    expect(hasValidChecksum(`${first8}${expected}`)).toBe(true);
  });

  it('every wrong check digit is rejected', () => {
    for (let c = 0; c < 10; c++) expect(hasValidChecksum(`12345678${c}`)).toBe(c === 2);
  });

  it('rejects anything that is not exactly 9 ASCII digits', () => {
    for (const bad of ['', '12345678', '1234567820', '12345678a', ' 123456782', '12345678٢', '-23456782']) {
      expect(hasValidChecksum(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('checksum vs the independent Luhn oracle', () => {
  it('agrees on 30,000 random 9-digit strings', () => {
    const rnd = mulberry32(20260929);
    let valid = 0;
    for (let i = 0; i < 30_000; i++) {
      const s = randomDigits(rnd, 9);
      const expected = luhnValid(s);
      if (expected) valid += 1;
      expect(hasValidChecksum(s), s).toBe(expected);
    }
    // sanity: about one in ten random numbers passes
    expect(valid).toBeGreaterThan(2_500);
    expect(valid).toBeLessThan(3_500);
  });

  it('checkDigitFor completes every 8-digit prefix like the oracle (exhaustive over 100,000 prefixes)', () => {
    for (let n = 0; n < 100_000; n++) {
      const first8 = String(n).padStart(8, '0');
      expect(first8 + checkDigitFor(first8)).toBe(withCheckDigit(first8));
    }
  });

  it('detects every single-digit error in valid numbers', () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 300; i++) {
      const id = withCheckDigit(randomDigits(rnd, 8));
      for (let pos = 0; pos < 9; pos++) {
        for (let d = 0; d < 10; d++) {
          if (String(d) === id[pos]) continue;
          const mutated = id.slice(0, pos) + d + id.slice(pos + 1);
          expect(hasValidChecksum(mutated), `${id} -> ${mutated}`).toBe(false);
        }
      }
    }
  });

  it('detects adjacent transpositions except the 09 <-> 90 pair (Luhn property)', () => {
    const rnd = mulberry32(11);
    let checked = 0;
    for (let i = 0; i < 500; i++) {
      const id = withCheckDigit(randomDigits(rnd, 8));
      for (let pos = 0; pos < 8; pos++) {
        const a = id[pos] as string;
        const b = id[pos + 1] as string;
        if (a === b) continue;
        const swapped = id.slice(0, pos) + b + a + id.slice(pos + 2);
        const pair = new Set([a, b]);
        const isNineZero = pair.has('0') && pair.has('9');
        if (isNineZero) continue;
        expect(hasValidChecksum(swapped), `${id} -> ${swapped}`).toBe(false);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(1_000);
  });
});

describe('placeholder patterns', () => {
  it.each(['000000000', '111111111', '222222222', '999999999', '2222222', '00', '55'])('%s: all the same digit', (s) => {
    expect(isRepeatedDigits(s)).toBe(true);
    expect(looksLikePlaceholder(s)).toBe(true);
  });

  it.each(['123456789', '987654321', '012345678', '876543210', '901234567', '12345', '54321', '0123456', '567890'])('%s: consecutive run', (s) => {
    expect(isSequentialDigits(s)).toBe(true);
    expect(looksLikePlaceholder(s)).toBe(true);
  });

  it.each(['111111118', '222222226', '11111118', '00000005', '2222227'])('%s: repeated digits plus a check digit', (s) => {
    expect(isRepeatedWithCheckDigit(s)).toBe(true);
    expect(looksLikePlaceholder(s)).toBe(true);
  });

  it.each(['123456782', '000000018', '314159260', '271828188', '510000003', '1234', '1234568', '12', '5', '', '61000'])('%s is not a placeholder', (s) => {
    expect(looksLikePlaceholder(s)).toBe(false);
  });

  it('short numbers are never sequential (needs 5+ digits)', () => {
    for (const s of ['1', '12', '123', '1234']) expect(isSequentialDigits(s)).toBe(false);
  });

  it('the well-known test ID passes the checksum and is not a placeholder', () => {
    for (const id of WELL_KNOWN_TEST_NUMBERS) {
      expect(hasValidChecksum(id)).toBe(true);
      expect(looksLikePlaceholder(id)).toBe(false);
    }
  });
});

describe('mod97', () => {
  it('matches the textbook big-integer computation', () => {
    const oracle = (s: string): number => {
      const digits = [...s].map((c) => (/[0-9]/.test(c) ? c : String(c.charCodeAt(0) - 55))).join('');
      return Number(BigInt(digits) % 97n);
    };
    const rnd = mulberry32(3);
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < 2_000; i++) {
      let s = '';
      for (let j = 0; j < 5 + Math.floor(rnd() * 30); j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      expect(mod97(s), s).toBe(oracle(s));
    }
  });

  it('the registry example IBAN has remainder 1 when rearranged', () => {
    expect(mod97('0108000000099999999IL62')).toBe(1);
  });

  it('throws only for characters outside A-Z0-9 (callers validate first)', () => {
    expect(() => mod97('12-34')).toThrow();
  });
});
