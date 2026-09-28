import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COUNTRIES, getBbanParts, parseBbanSpec } from '../src/lib/countries.js';
import { checkIban, computeCheckDigits, formatIban, mod97, normalizeIban } from '../src/lib/iban.js';
import { mulberry32, mutateChar as mutate, oracleMod97, oracleValid } from './helpers.js';

const raw = JSON.parse(readFileSync(new URL('./fixtures/registry-examples.json', import.meta.url), 'utf8')) as Record<string, string>;
const examples = Object.entries(raw).filter(([k]) => !k.startsWith('_'));

describe('mod97 (ISO 7064 MOD 97-10)', () => {
  it('matches known values', () => {
    expect(mod97('1')).toBe(1);
    expect(mod97('A')).toBe(10);
    expect(mod97('Z')).toBe(35);
    expect(mod97('AA')).toBe(1010 % 97);
    expect(mod97('WEST12345698765432GB82')).toBe(1); // the classic GB82 example, rearranged
  });

  it('agrees with a BigInt reference implementation on random alphanumeric strings', () => {
    const rnd = mulberry32(42);
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < 300; i++) {
      const len = 1 + Math.floor(rnd() * 40);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet.charAt(Math.floor(rnd() * alphabet.length));
      expect(mod97(s), s).toBe(oracleMod97(s));
    }
  });

  it('rejects characters that are not A-Z / 0-9', () => {
    expect(() => mod97('ab')).toThrow();
    expect(() => mod97('1-2')).toThrow();
  });
});

describe('computeCheckDigits', () => {
  it.each(examples)('reproduces the registry check digits for %s', (cc, iban) => {
    expect(computeCheckDigits(cc, iban.slice(4))).toBe(iban.slice(2, 4));
    const oracle = String(98 - oracleMod97(`${iban.slice(4)}${cc}00`)).padStart(2, '0');
    expect(computeCheckDigits(cc, iban.slice(4))).toBe(oracle);
  });

  it('always yields 02..98', () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      let bban = '';
      for (let j = 0; j < 18; j++) bban += String(Math.floor(rnd() * 10));
      const cd = Number(computeCheckDigits('DE', bban));
      expect(cd).toBeGreaterThanOrEqual(2);
      expect(cd).toBeLessThanOrEqual(98);
    }
  });
});

describe('normalizeIban / formatIban', () => {
  it('removes separators and upper-cases', () => {
    expect(normalizeIban('gb82 west 1234 5698 7654 32')).toBe('GB82WEST12345698765432');
    expect(normalizeIban('DE89-3704-0044-0532-0130-00')).toBe('DE89370400440532013000');
    expect(normalizeIban('  DE89 3704\t0044\n0532 0130 00  ')).toBe('DE89370400440532013000');
    expect(normalizeIban('DE89‐3704–0044​0532013000')).toBe('DE89370400440532013000'); // unicode dashes, zero-width space
  });

  it('drops a leading "IBAN" label only when it is a separate word', () => {
    expect(normalizeIban('IBAN: DE89 3704 0044 0532 0130 00')).toBe('DE89370400440532013000');
    expect(normalizeIban('iban DE89370400440532013000')).toBe('DE89370400440532013000');
    expect(normalizeIban('IBAN-DE89370400440532013000')).toBe('DE89370400440532013000');
    expect(normalizeIban('IBANDE89370400440532013000')).toBe('IBANDE89370400440532013000');
  });

  it('turns full-width characters into ASCII (NFKC)', () => {
    expect(normalizeIban('ＤＥ８９３７０４００４４０５３２０１３０００')).toBe('DE89370400440532013000');
  });

  it('formats in groups of four without a trailing space', () => {
    expect(formatIban('GB82WEST12345698765432')).toBe('GB82 WEST 1234 5698 7654 32');
    expect(formatIban('NL91ABNA0417164300')).toBe('NL91 ABNA 0417 1643 00');
    expect(formatIban('BE68539007547034')).toBe('BE68 5390 0754 7034'); // exact multiple of 4
    expect(formatIban('')).toBe('');
  });
});

describe('country table', () => {
  it('has one registry example per country and vice versa, with matching lengths', () => {
    expect(Object.keys(COUNTRIES).sort()).toEqual(examples.map(([cc]) => cc).sort());
    for (const [cc, iban] of examples) expect(iban.length, cc).toBe(COUNTRIES[cc]?.length);
    expect(Object.keys(COUNTRIES).length).toBeGreaterThanOrEqual(79);
  });

  it('has well-formed entries', () => {
    const names = new Set<string>();
    for (const [cc, info] of Object.entries(COUNTRIES)) {
      expect(cc).toMatch(/^[A-Z]{2}$/);
      expect(info.code).toBe(cc);
      expect(info.length).toBeGreaterThanOrEqual(15); // shortest IBAN (Norway)
      expect(info.length).toBeLessThanOrEqual(34); // ISO 13616 maximum
      expect(names.has(info.name), `duplicate name ${info.name}`).toBe(false);
      names.add(info.name);
    }
    expect(COUNTRIES.NO?.length).toBe(15);
  });

  it('every BBAN spec parses and adds up to length - 4', () => {
    for (const [cc, info] of Object.entries(COUNTRIES)) {
      if (!info.bban) continue;
      const total = parseBbanSpec(info.bban).reduce((sum, p) => sum + p.length, 0);
      expect(total, `${cc} spec "${info.bban}"`).toBe(info.length - 4);
    }
  });

  it('rejects malformed BBAN specs', () => {
    expect(() => parseBbanSpec('8x:bank')).toThrow();
    expect(() => parseBbanSpec('n8')).toThrow();
    expect(() => parseBbanSpec('8n:owner')).toThrow();
    expect(getBbanParts('ZZ')).toBeNull(); // unknown country
    expect(getBbanParts('DE')).toHaveLength(2);
  });
});

describe('valid IBANs: one registry example per country', () => {
  it.each(examples)('%s example is valid, per the real checksum and the oracle', (cc, iban) => {
    expect(oracleValid(iban), 'oracle').toBe(true);
    const r = checkIban(iban);
    expect(r).toMatchObject({
      valid: true,
      reasonCode: 'OK',
      iban,
      countryCode: cc,
      countryName: COUNTRIES[cc]?.name,
      checkDigits: iban.slice(2, 4),
      bban: iban.slice(4),
    });
    expect(r.ibanFormatted?.replace(/ /g, '')).toBe(iban);
    expect(r.ibanFormatted?.split(' ').slice(0, -1).every((g) => g.length === 4)).toBe(true);
  });

  it.each(examples)('%s example is accepted in every common notation', (_cc, iban) => {
    const variants = [
      iban.toLowerCase(),
      formatIban(iban),
      formatIban(iban).toLowerCase(),
      iban.replace(/(.{4})/g, '$1-'),
      `IBAN ${formatIban(iban)}`,
      `  ${iban}  `,
      formatIban(iban).replace(/ /g, ' '),
      iban.split('').join(' '),
    ];
    for (const v of variants) expect(checkIban(v), JSON.stringify(v)).toMatchObject({ valid: true, iban });
  });
});

describe('invalid IBANs derived from every registry example', () => {
  it.each(examples)('%s: a single mistyped character is caught by the checksum', (_cc, iban) => {
    // Try the last character and one in the middle of the BBAN; both same-class substitutions.
    for (const pos of [iban.length - 1, Math.floor(iban.length / 2) + 2]) {
      const bad = iban.slice(0, pos) + mutate(iban.charAt(pos)) + iban.slice(pos + 1);
      expect(oracleValid(bad), `oracle ${bad}`).toBe(false);
      const r = checkIban(bad);
      // A mutation may also break the national format of a spec'd country; either way it is invalid.
      expect(r.valid, bad).toBe(false);
      expect(['BAD_CHECKSUM', 'BAD_BBAN_FORMAT']).toContain(r.reasonCode);
      expect(r.ibanFormatted).toBeNull();
      expect(r.bankCode).toBeNull();
    }
  });

  it.each(examples)('%s: wrong length is reported with the expected length', (cc, iban) => {
    for (const bad of [`${iban}0`, iban.slice(0, -1)]) {
      const r = checkIban(bad);
      expect(r).toMatchObject({ valid: false, reasonCode: 'WRONG_LENGTH', countryCode: cc });
      expect(r.reason).toContain(String(iban.length));
    }
  });

  it('unknown country codes are reported as such', () => {
    const r = checkIban('ZZ89370400440532013000');
    expect(r).toMatchObject({ valid: false, reasonCode: 'UNKNOWN_COUNTRY', countryCode: 'ZZ', countryName: null });
  });

  it('adjacent digit transpositions are detected', () => {
    let tested = 0;
    for (const [, iban] of examples) {
      for (let i = 4; i < iban.length - 1; i++) {
        const a = iban.charAt(i);
        const b = iban.charAt(i + 1);
        if (!/[0-9]/.test(a) || !/[0-9]/.test(b) || a === b) continue;
        const swapped = iban.slice(0, i) + b + a + iban.slice(i + 2);
        expect(checkIban(swapped).valid, swapped).toBe(false);
        tested++;
        break;
      }
    }
    expect(tested).toBeGreaterThan(60);
  });
});

describe('well-known cases', () => {
  it('GB82 example: valid, and invalid with one changed digit', () => {
    expect(checkIban('GB82 WEST 1234 5698 7654 32').valid).toBe(true);
    const bad = checkIban('GB82 WEST 1234 5698 7654 33');
    expect(bad).toMatchObject({ valid: false, reasonCode: 'BAD_CHECKSUM', countryCode: 'GB', countryName: 'United Kingdom' });
    expect(bad.reason).toMatch(/remainder is \d+, expected 1/);
  });

  it('German example and its typo', () => {
    expect(checkIban('DE89 3704 0044 0532 0130 00').valid).toBe(true);
    expect(checkIban('DE89 3704 0044 0532 0130 01').reasonCode).toBe('BAD_CHECKSUM');
    expect(checkIban('DE88 3704 0044 0532 0130 00').reasonCode).toBe('BAD_CHECKSUM');
  });

  it('check digits 00, 01 and 99 are never valid even if the raw mod-97 happens to pass', () => {
    const found: Record<string, string> = {};
    // mod97(bban + "DE" + cd) === (r00 + cd) % 97, so cd=00 needs r00=1, cd=01 needs r00=0, cd=99 needs r00=96
    const wanted: Record<number, string> = { 1: '00', 0: '01', 96: '99' };
    for (let n = 0; n < 5000 && Object.keys(found).length < 3; n++) {
      const bban = String(n * 7919).padStart(18, '0');
      const cd = wanted[oracleMod97(`${bban}DE00`)];
      if (cd && !found[cd]) found[cd] = `DE${cd}${bban}`;
    }
    expect(Object.keys(found).sort()).toEqual(['00', '01', '99']);
    for (const [cd, iban] of Object.entries(found)) {
      expect(oracleValid(iban), `raw checksum passes for ${iban}`).toBe(true);
      const r = checkIban(iban);
      expect(r, iban).toMatchObject({ valid: false, reasonCode: 'BAD_CHECKSUM' });
      expect(r.reason, cd).toContain('never valid');
    }
  });
});

describe('national format (BBAN structure) checks', () => {
  it('rejects letters where digits are required, before the checksum', () => {
    const r = checkIban('DE89370400440532O13000'); // letter O instead of zero
    expect(r).toMatchObject({ valid: false, reasonCode: 'BAD_BBAN_FORMAT', countryCode: 'DE' });
    expect(r.reason).toContain('a digit');
  });

  it('rejects digits where the bank code must be letters (GB, NL)', () => {
    expect(checkIban('GB29NW1K60161331926819').reasonCode).toBe('BAD_BBAN_FORMAT');
    expect(checkIban('NL91AB1A0417164300').reasonCode).toBe('BAD_BBAN_FORMAT');
  });

  it('allows letters in alphanumeric account fields (FR, IT, MT, RO)', () => {
    for (const cc of ['FR', 'IT', 'MT', 'RO']) expect(checkIban(raw[cc] as string).valid, cc).toBe(true);
  });

  it('countries with an unlabeled layout are format-checked but nothing is extracted (BR)', () => {
    const r = checkIban(raw.BR as string);
    expect(r).toMatchObject({ valid: true, bankCode: null, branchCode: null, accountNumber: null });
    // BR layout is 23n 1a 1c: a letter inside the numeric block is a format error, found before the checksum
    const bad = `BR18A${(raw.BR as string).slice(5)}`;
    expect(checkIban(bad)).toMatchObject({ valid: false, reasonCode: 'BAD_BBAN_FORMAT', countryCode: 'BR' });
  });
});

describe('malformed input', () => {
  it.each([
    ['DE89 3704 0044 0532 0130 0!', '!'],
    ['DE89.3704.0044.0532.0130.00', '.'],
    ['DE89_3704_0044_0532_0130_00', '_'],
    ['DE89 3704 0044 0532 0130 0Ü', 'Ü'],
    ['DE89 3704 0044 0532 0130 00 😀', '😀'],
  ])('%s -> INVALID_CHARACTERS', (input, ch) => {
    const r = checkIban(input);
    expect(r).toMatchObject({ valid: false, reasonCode: 'INVALID_CHARACTERS', countryCode: null });
    expect(r.reason).toContain(ch);
  });

  it.each(['NOTANIBAN', '1234567890', 'D', 'DE', 'DE8', '89DE3704', 'D1E89370400440532013000'])('%s -> BAD_PREFIX', (input) => {
    expect(checkIban(input)).toMatchObject({ valid: false, reasonCode: 'BAD_PREFIX', countryCode: null, countryName: null });
  });

  it('does not mislabel arbitrary text as a country (NOTANIBAN starts with the letters NO)', () => {
    expect(checkIban('NOTANIBAN').countryName).toBeNull();
  });

  it.each(['', '   ', '-', ' - - ', 'IBAN', 'IBAN:', '​'])('%j -> EMPTY', (input) => {
    expect(checkIban(input)).toMatchObject({ valid: false, reasonCode: 'EMPTY', iban: null });
  });

  it('never throws and keeps its invariants on arbitrary strings (fuzz)', () => {
    const rnd = mulberry32(2024);
    const pieces = ['DE', 'GB', 'ZZ', '89', '00', ' ', '-', '.', 'é', '😀', '\u0000', 'A', 'z', '9', 'IBAN', '\n', 'NL91ABNA0417164300', '﷽'];
    for (let i = 0; i < 3000; i++) {
      let s = '';
      const n = Math.floor(rnd() * 8);
      for (let j = 0; j < n; j++) s += pieces[Math.floor(rnd() * pieces.length)];
      const r = checkIban(s);
      expect(typeof r.valid).toBe('boolean');
      expect(typeof r.reason).toBe('string');
      if (r.valid) {
        expect(oracleValid(r.iban as string)).toBe(true);
        expect(r.ibanFormatted).not.toBeNull();
      } else {
        expect(r.ibanFormatted).toBeNull();
        expect(r.checkDigits).toBeNull();
        expect(r.bban).toBeNull();
      }
    }
  });

  it('copes with non-string input coming from untyped callers', () => {
    expect(checkIban(undefined as unknown as string).reasonCode).toBe('EMPTY');
    expect(checkIban(null as unknown as string).reasonCode).toBe('EMPTY');
    expect(checkIban(12345 as unknown as string).reasonCode).toBe('BAD_PREFIX');
  });
});

describe('bank / branch / account extraction', () => {
  const cases: Array<[string, { bankCode: string | null; branchCode: string | null; accountNumber: string | null }]> = [
    ['DE89370400440532013000', { bankCode: '37040044', branchCode: null, accountNumber: '0532013000' }],
    ['GB82WEST12345698765432', { bankCode: 'WEST', branchCode: '123456', accountNumber: '98765432' }],
    ['FR1420041010050500013M02606', { bankCode: '20041', branchCode: '01005', accountNumber: '0500013M026' }],
    ['ES9121000418450200051332', { bankCode: '2100', branchCode: '0418', accountNumber: '0200051332' }],
    ['IT60X0542811101000000123456', { bankCode: '05428', branchCode: '11101', accountNumber: '000000123456' }],
    ['NL91ABNA0417164300', { bankCode: 'ABNA', branchCode: null, accountNumber: '0417164300' }],
    ['BE68539007547034', { bankCode: '539', branchCode: null, accountNumber: '0075470' }],
    ['CH9300762011623852957', { bankCode: '00762', branchCode: null, accountNumber: '011623852957' }],
    ['AT611904300234573201', { bankCode: '19043', branchCode: null, accountNumber: '00234573201' }],
    ['PT50000201231234567890154', { bankCode: '0002', branchCode: '0123', accountNumber: '12345678901' }],
    ['IE29AIBK93115212345678', { bankCode: 'AIBK', branchCode: '931152', accountNumber: '12345678' }],
    ['PL61109010140000071219812874', { bankCode: '109', branchCode: '0101', accountNumber: '0000071219812874' }],
    ['CY17002001280000001200527600', { bankCode: '002', branchCode: '00128', accountNumber: '0000001200527600' }],
    ['GR1601101250000000012300695', { bankCode: '011', branchCode: '0125', accountNumber: '0000000012300695' }],
    ['MT84MALT011000012345MTLCAST001S', { bankCode: 'MALT', branchCode: '01100', accountNumber: '0012345MTLCAST001S' }],
    ['BG80BNBG96611020345678', { bankCode: 'BNBG', branchCode: '9661', accountNumber: '20345678' }],
    ['SI56263300012039086', { bankCode: '26', branchCode: '330', accountNumber: '00120390' }],
    ['HU42117730161111101800000000', { bankCode: '117', branchCode: '7301', accountNumber: '111110180000000' }],
    ['EE382200221020145685', { bankCode: '22', branchCode: '00', accountNumber: '22102014568' }],
    ['SE4550000000058398257466', { bankCode: '500', branchCode: null, accountNumber: '0000005839825746' }],
    ['DK5000400440116243', { bankCode: '0040', branchCode: null, accountNumber: '044011624' }],
    ['NO9386011117947', { bankCode: '8601', branchCode: null, accountNumber: '111794' }],
    ['LU280019400644750000', { bankCode: '001', branchCode: null, accountNumber: '9400644750000' }],
    ['FI2112345600000785', { bankCode: '123', branchCode: null, accountNumber: '0000078' }],
    ['IS140159260076545510730339', { bankCode: '01', branchCode: '59', accountNumber: '007654' }],
    ['XK051212012345678906', { bankCode: '12', branchCode: '12', accountNumber: '0123456789' }],
  ];

  it.each(cases)('%s', (iban, expected) => {
    expect(checkIban(iban)).toMatchObject({ valid: true, ...expected });
  });

  it('extracts nothing from invalid IBANs', () => {
    expect(checkIban('DE89370400440532013001')).toMatchObject({ bankCode: null, branchCode: null, accountNumber: null, bban: null });
  });

  it('the extracted parts are consistent with the BBAN for every country that defines roles', () => {
    for (const [cc, iban] of examples) {
      const parts = getBbanParts(cc);
      if (!parts) continue;
      const r = checkIban(iban);
      const bban = iban.slice(4);
      let offset = 0;
      let bank = '';
      let branch = '';
      let account = '';
      for (const p of parts) {
        const chunk = bban.slice(offset, offset + p.length);
        if (p.role === 'bank') bank += chunk;
        if (p.role === 'branch') branch += chunk;
        if (p.role === 'account') account += chunk;
        offset += p.length;
      }
      expect(r.bankCode, cc).toBe(bank || null);
      expect(r.branchCode, cc).toBe(branch || null);
      expect(r.accountNumber, cc).toBe(account || null);
      expect(offset).toBe(bban.length);
    }
  });
});
