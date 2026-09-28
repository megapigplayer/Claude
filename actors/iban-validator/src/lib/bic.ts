/**
 * BIC / SWIFT code FORMAT check (ISO 9362): 4 letters institution code + 2 letters country
 * code + 2 letters/digits location code + optional 3 letters/digits branch code.
 * This checks the shape only; it does NOT look the code up in any SWIFT directory and does
 * not verify that the 2 country letters are an assigned ISO 3166 code.
 */

export interface BicCheck {
  /** Normalised (upper case, no spaces); null when no BIC was provided. */
  bic: string | null;
  /** null when no BIC was provided. */
  valid: boolean | null;
  /** Explanation when invalid, otherwise null. */
  reason: string | null;
}

export function checkBic(raw: string | null | undefined): BicCheck {
  const bic = String(raw ?? '')
    .normalize('NFKC')
    .replace(/[\s​-‍﻿]+/g, '')
    .toUpperCase();
  if (bic === '') return { bic: null, valid: null, reason: null };

  if (bic.length !== 8 && bic.length !== 11) {
    return { bic, valid: false, reason: `A BIC has 8 or 11 characters, but this one has ${bic.length}.` };
  }
  if (!/^[A-Z]{4}/.test(bic)) {
    return { bic, valid: false, reason: 'Characters 1-4 (institution code) must be letters A-Z.' };
  }
  if (!/^[A-Z]{4}[A-Z]{2}/.test(bic)) {
    return { bic, valid: false, reason: 'Characters 5-6 (country code) must be letters A-Z.' };
  }
  if (!/^[A-Z]{6}[A-Z0-9]{2}/.test(bic)) {
    return { bic, valid: false, reason: 'Characters 7-8 (location code) must be letters or digits.' };
  }
  if (bic.length === 11 && !/^[A-Z]{6}[A-Z0-9]{5}$/.test(bic)) {
    return { bic, valid: false, reason: 'Characters 9-11 (branch code) must be letters or digits.' };
  }
  return { bic, valid: true, reason: null };
}
