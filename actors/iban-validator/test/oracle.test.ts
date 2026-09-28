/**
 * Differential tests against `ibantools` (exact-pinned devDependency, test-only, never shipped):
 * an independently maintained IBAN library with its own country table. It is used as an ORACLE to
 * cross-check the data this Actor's author had to write from memory (no access to the SWIFT
 * registry offline). Where the two disagree, the disagreement is listed here and explained.
 */
import { countrySpecs, isValidBIC, isValidIBAN } from 'ibantools';
import { describe, expect, it } from 'vitest';
import { checkBic } from '../src/lib/bic.js';
import { COUNTRIES, getBbanParts } from '../src/lib/countries.js';
import { checkIban } from '../src/lib/iban.js';
import { mulberry32, mutateChar, randomIban } from './helpers.js';
import registryExamples from './fixtures/registry-examples.json' with { type: 'json' };

const mine = Object.values(COUNTRIES);

/** Expand "[A-Z]{4}[0-9]{14}" style regexps into a per-position class string like "aaaannnn...". */
function classesFromRegexp(re: string): string | null {
  const body = re.replace(/^\^/, '').replace(/\$$/, '');
  const tokens = [...body.matchAll(/\[([^\]]+)\]\{(\d+)\}/g)];
  if (tokens.map((t) => t[0]).join('') !== body) return null;
  return tokens
    .map(([, set, n]) => {
      const cls = set === '0-9' ? 'n' : set === 'A-Z' ? 'a' : set === 'A-Z0-9' || set === '0-9A-Z' ? 'c' : '?';
      return cls.repeat(Number(n));
    })
    .join('');
}

const ownClasses = (cc: string) => (getBbanParts(cc) ?? []).map((p) => p.charClass.repeat(p.length)).join('');

const span = (cc: string, role: 'bank' | 'branch'): string | null => {
  let offset = 0;
  let start: number | null = null;
  let end = 0;
  for (const part of getBbanParts(cc) ?? []) {
    if (part.role === role) {
      if (start === null) start = offset;
      end = offset + part.length - 1;
    }
    offset += part.length;
  }
  return start === null ? null : `${start}-${end}`;
};

describe('country coverage and lengths vs ibantools', () => {
  it('every supported country is an IBAN-registry country in ibantools with the same length', () => {
    for (const c of mine) {
      const theirs = countrySpecs[c.code];
      expect(theirs, c.code).toBeDefined();
      expect(theirs?.IBANRegistry, `${c.code} registry flag`).toBe(true);
      expect(theirs?.chars, `${c.code} length`).toBe(c.length);
    }
  });

  it('the registry countries we do NOT support are exactly the territories that share a parent IBAN prefix', () => {
    const notSupported = Object.entries(countrySpecs)
      .filter(([cc, s]) => s.IBANRegistry === true && !COUNTRIES[cc])
      .map(([cc]) => cc)
      .sort();
    // Aland (FI) and the French overseas territories use the FR/FI prefix; their own ISO code is not an IBAN prefix.
    expect(notSupported).toEqual(['AX', 'GF', 'GP', 'MF', 'MQ', 'NC', 'PF', 'PM', 'RE', 'TF', 'WF', 'YT']);
  });

  it('a supported IBAN prefix is never one of the non-registry "experimental" codes', () => {
    for (const c of mine) expect(countrySpecs[c.code]?.IBANRegistry).toBe(true);
  });
});

describe('BBAN layout vs ibantools', () => {
  // Policy: our per-position class must be a SUPERSET of ibantools' (never stricter, so a real IBAN is
  // never rejected for its layout). Being more permissive is only allowed where documented here.
  const MORE_PERMISSIVE: Record<string, string> = {
    BY: 'ibantools requires letters for the 4-char bank code; the registry layout is 4!c (alphanumeric)',
    PK: 'ibantools requires 16 digits for the account part; we accept alphanumerics',
  };
  const covers = (ours: string, theirs: string) => ours === theirs || (ours === 'c' && (theirs === 'a' || theirs === 'n'));

  it.each(mine.map((c) => c.code))('%s: our character classes cover ibantools\' and are equal unless documented', (cc) => {
    const theirs = classesFromRegexp(countrySpecs[cc]?.bban_regexp ?? '');
    expect(theirs, `could not parse ibantools regexp ${countrySpecs[cc]?.bban_regexp}`).not.toBeNull();
    const ours = ownClasses(cc);
    expect(ours.length).toBe(theirs?.length);
    for (let i = 0; i < ours.length; i++) {
      expect(covers(ours.charAt(i), (theirs as string).charAt(i)), `${cc} position ${i + 5}: ours ${ours.charAt(i)} vs theirs ${(theirs as string).charAt(i)}`).toBe(true);
    }
    if (!MORE_PERMISSIVE[cc]) expect(ours).toBe(theirs);
  });

  // Where ibantools defines bank / branch identifiers (BBAN positions, inclusive) they must match ours.
  const KNOWN_DIFFERENCES: Record<string, string> = {
    JO: 'ibantools gives the same span (4-7, the digits) for bank and branch; the registry layout 4!a4!n18!c makes the 4 letters (e.g. CBJO) the bank code',
    AL: 'ibantools includes the 1-digit national check in the branch span (3-7); the layout is 3!n bank, 4!n branch, 1!n check',
    PL: 'ibantools treats the whole 8-digit sort code as the branch (0-7); the national layout is 3 bank + 4 branch + 1 check',
  };

  it('bank and branch positions agree wherever we label them and ibantools defines them (documented exceptions only)', () => {
    let agreeingBank = 0;
    let agreeingBranch = 0;
    const differences: string[] = [];
    for (const c of mine) {
      const theirs = countrySpecs[c.code];
      for (const [role, theirSpan] of [['bank', theirs?.bank_identifier], ['branch', theirs?.branch_indentifier]] as const) {
        const ours = span(c.code, role);
        if (ours === null || !theirSpan) continue; // we do not label it, or they do not define it
        if (ours === theirSpan) {
          if (role === 'bank') agreeingBank++;
          else agreeingBranch++;
        } else if (!KNOWN_DIFFERENCES[c.code]) differences.push(`${c.code} ${role}: ours ${ours} vs ${theirSpan}`);
      }
    }
    expect(differences).toEqual([]);
    expect(agreeingBank).toBeGreaterThanOrEqual(45);
    expect(agreeingBranch).toBeGreaterThanOrEqual(10);
  });

  it('whenever we label any role for a country, we label a bank code', () => {
    for (const c of mine) {
      const hasRoles = (getBbanParts(c.code) ?? []).some((p) => p.role);
      if (hasRoles) expect(span(c.code, 'bank'), c.code).not.toBeNull();
    }
  });
});

describe('validity vs ibantools (differential fuzzing, seeded)', () => {
  // ibantools also verifies NATIONAL check digits inside the BBAN for these countries (found by
  // fuzzing random layout-conforming IBANs). This Actor checks ISO 13616 length + layout + mod-97
  // only, so for these countries a random layout-valid IBAN is "valid" here but not there. This list is
  // mirrored in the README under Limitations; the test fails if ibantools' behaviour changes.
  const NATIONAL_CHECK_COUNTRIES = ['BA', 'BE', 'BY', 'CZ', 'EE', 'ES', 'FR', 'HR', 'HU', 'MC', 'ME', 'MK', 'NO', 'PK', 'PL', 'PT', 'RS', 'SI', 'SK'];

  it('every registry example is valid for both', () => {
    for (const [cc, iban] of Object.entries(registryExamples)) {
      if (cc.startsWith('_')) continue;
      expect(isValidIBAN(iban as string), `ibantools ${cc}`).toBe(true);
      expect(checkIban(iban as string).valid, `ours ${cc}`).toBe(true);
    }
  });

  it('random layout-conforming IBANs: we never reject one that ibantools accepts; ibantools only objects in the national-check countries', () => {
    const rnd = mulberry32(20260928);
    const theirsRejects = new Set<string>();
    for (const c of mine) {
      for (let i = 0; i < 40; i++) {
        const iban = randomIban(c.code, rnd);
        const ours = checkIban(iban);
        expect(ours.valid, `${iban} should be valid here: ${ours.reason}`).toBe(true);
        if (!isValidIBAN(iban)) theirsRejects.add(c.code);
      }
    }
    expect([...theirsRejects].sort()).toEqual(NATIONAL_CHECK_COUNTRIES);
  });

  it('single-character mistakes are rejected by both (checksum / layout)', () => {
    const rnd = mulberry32(31337);
    for (const c of mine) {
      for (let i = 0; i < 15; i++) {
        const iban = randomIban(c.code, rnd);
        const pos = 4 + Math.floor(rnd() * (iban.length - 4));
        const bad = iban.slice(0, pos) + mutateChar(iban.charAt(pos)) + iban.slice(pos + 1);
        expect(checkIban(bad).valid, `ours ${bad}`).toBe(false);
        expect(isValidIBAN(bad), `ibantools ${bad}`).toBe(false);
      }
    }
  });

  it('whenever ibantools says valid for a random alphanumeric string of any supported length, so do we (no false rejections)', () => {
    const rnd = mulberry32(555);
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let theirsValid = 0;
    for (let i = 0; i < 20000; i++) {
      const c = mine[Math.floor(rnd() * mine.length)]!;
      let s = c.code + String(Math.floor(rnd() * 90) + 10);
      while (s.length < c.length) s += alphabet.charAt(Math.floor(rnd() * (rnd() < 0.7 ? 10 : 36)));
      if (isValidIBAN(s)) {
        theirsValid++;
        expect(checkIban(s).valid, s).toBe(true);
      }
    }
    // random strings are valid with probability ~1/97 x layout match, so a handful is enough to prove the direction
    expect(theirsValid).toBeGreaterThan(0);
  });
});

describe('BIC vs ibantools', () => {
  const countries = ['DE', 'GB', 'FR', 'NL', 'US', 'ES', 'IT', 'CH', 'AT', 'BE'];
  const rnd = mulberry32(8);
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const alnum = letters + '0123456789';
  const pick = (s: string) => s.charAt(Math.floor(rnd() * s.length));

  it('well-formed BICs with real country codes are valid for both (8 and 11 characters)', () => {
    for (let i = 0; i < 300; i++) {
      const bic =
        pick(letters) + pick(letters) + pick(letters) + pick(letters) + countries[i % countries.length] + pick(alnum) + pick(alnum) + (i % 2 ? pick(alnum) + pick(alnum) + pick(alnum) : '');
      expect(isValidBIC(bic), `ibantools ${bic}`).toBe(true);
      expect(checkBic(bic), `ours ${bic}`).toEqual({ bic, valid: true, reason: null });
    }
  });

  it.each(['DEUTDE', 'DEUTDEFF5', 'DEUTDEFF5000', 'D3UTDEFF', 'DEUTDEFF5*0', '12345678', ''])('malformed %j is rejected by both', (bic) => {
    expect(isValidBIC(bic)).toBe(false);
    expect(checkBic(bic).valid).not.toBe(true);
  });

  it('the one documented difference: we do not check that the country letters are an assigned ISO code', () => {
    expect(isValidBIC('ABCDXX12')).toBe(false);
    expect(checkBic('ABCDXX12').valid).toBe(true);
  });
});
