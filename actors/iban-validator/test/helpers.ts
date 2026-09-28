import { getBbanParts, type CharClass } from '../src/lib/countries.js';
import { computeCheckDigits } from '../src/lib/iban.js';

/** Small seeded PRNG so every "random" test is reproducible. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Independent oracle: the textbook ISO 7064 computation with big integers. */
export function oracleMod97(alnum: string): number {
  const digits = [...alnum].map((c) => (/[0-9]/.test(c) ? c : String(c.charCodeAt(0) - 55))).join('');
  return Number(BigInt(digits) % 97n);
}

export const oracleValid = (iban: string): boolean => oracleMod97(iban.slice(4) + iban.slice(0, 4)) === 1;

const ALPHABETS: Record<CharClass, string> = {
  n: '0123456789',
  a: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  c: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
};

/** A random BBAN that satisfies the country's character-class layout. */
export function randomBban(countryCode: string, rnd: () => number): string {
  const parts = getBbanParts(countryCode);
  if (!parts) throw new Error(`no layout for ${countryCode}`);
  let bban = '';
  for (const part of parts) {
    const alphabet = ALPHABETS[part.charClass];
    for (let i = 0; i < part.length; i++) bban += alphabet.charAt(Math.floor(rnd() * alphabet.length));
  }
  return bban;
}

/** A random IBAN that passes length, layout and mod-97 for the country (national check digits are NOT considered). */
export function randomIban(countryCode: string, rnd: () => number): string {
  const bban = randomBban(countryCode, rnd);
  return `${countryCode}${computeCheckDigits(countryCode, bban)}${bban}`;
}

/** Same-class substitution of one character, so only the checksum (or national checks) can notice. */
export function mutateChar(ch: string): string {
  if (/[0-9]/.test(ch)) return String((Number(ch) + 1) % 10);
  return String.fromCharCode(((ch.charCodeAt(0) - 65 + 1) % 26) + 65);
}
