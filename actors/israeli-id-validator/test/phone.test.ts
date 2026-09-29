import { describe, expect, it } from 'vitest';
import { checkIsraeliPhone, splitExtension } from '../src/lib/phone.js';
import { ALM, LRM, mulberry32, randomDigits, RLM, toArabicIndic, toPersian } from './helpers.js';

const phone = (s: string, normalize = true) => checkIsraeliPhone(s, normalize);

describe('mobile numbers normalize to E.164', () => {
  it.each([
    ['053-1234567', '+972531234567'],
    ['0531234567', '+972531234567'],
    ['053 123 4567', '+972531234567'],
    ['053.123.4567', '+972531234567'],
    ['(053) 123-4567', '+972531234567'],
    ['+972-53-123-4567', '+972531234567'],
    ['+972 53 123 4567', '+972531234567'],
    ['972531234567', '+972531234567'],
    ['00972531234567', '+972531234567'],
    ['00 972 53 123 4567', '+972531234567'],
    ['+972 (0)53-123-4567', '+972531234567'],
    ['+97205 31234567', '+972531234567'],
    ['531234567', '+972531234567'],
    ['050-2345678', '+972502345678'],
    ['052-2345678', '+972522345678'],
    ['054-2345678', '+972542345678'],
    ['058-3345678', '+972583345678'],
  ])('%s -> %s', (input, e164) => {
    const r = phone(input);
    expect(r, input).toMatchObject({ valid: true, reasonCode: 'OK', normalized: e164 });
    expect(r.details).toMatchObject({ e164, region: 'IL', phoneType: 'mobile', extension: null });
  });

  it('gives the national and international display formats', () => {
    expect(phone('0502345678').details).toMatchObject({ national: '050-234-5678', international: '+972 50 234 5678' });
  });

  it('a "050-..." mobile normalizes to +9725...', () => {
    expect(phone('050-2345678').normalized).toMatch(/^\+9725/);
  });
});

describe('the numbering plan, not just the length', () => {
  it('050-1234567 has a plausible length but an unallocated prefix: BAD_FORMAT', () => {
    const r = phone('050-1234567');
    expect(r).toMatchObject({ valid: false, reasonCode: 'BAD_FORMAT', normalized: null, details: null });
    expect(r.reason).toContain('numbering plan');
  });

  it.each(['052-1234567', '054-1234567', '055-1234567', '058-1234567', '059-1234567', '051-1234567', '057-1234567'])('%s is not in the plan', (s) => {
    expect(phone(s)).toMatchObject({ valid: false, reasonCode: 'BAD_FORMAT' });
  });

  it.each(['053-1234567', '056-1234567', '050-0000000'])('%s is in the plan', (s) => {
    expect(phone(s).valid).toBe(true);
  });
});

describe('landlines, VoIP and special numbers', () => {
  it.each([
    ['03-1234567', '+97231234567', 'fixed-line'],
    ['031234567', '+97231234567', 'fixed-line'],
    ['31234567', '+97231234567', 'fixed-line'],
    ['02-6234567', '+97226234567', 'fixed-line'],
    ['04-8123456', '+97248123456', 'fixed-line'],
    ['08-9234567', '+97289234567', 'fixed-line'],
    ['09-7654321', '+97297654321', 'fixed-line'],
    ['+972-3-123-4567', '+97231234567', 'fixed-line'],
    ['+972 (0)3 123 4567', '+97231234567', 'fixed-line'],
    ['072-3456789', '+972723456789', 'voip'],
    ['077-1234567', '+972771234567', 'voip'],
    ['1-800-123-456', '+9721800123456', 'toll-free'],
    ['1800123456', '+9721800123456', 'toll-free'],
    ['1-700-123-456', '+9721700123456', 'shared-cost'],
    ['1-900-123-456', '+9721900123456', 'premium-rate'],
  ])('%s -> %s (%s)', (input, e164, type) => {
    expect(phone(input), input).toMatchObject({ valid: true, normalized: e164 });
    expect(phone(input).details).toMatchObject({ phoneType: type });
  });

  it('a VoIP prefix outside the plan is invalid', () => {
    expect(phone('074-1234567')).toMatchObject({ valid: false, reasonCode: 'BAD_FORMAT' });
    expect(phone('076-1234567')).toMatchObject({ valid: false });
  });
});

describe('extensions', () => {
  it.each(['053-1234567 ext 12', '053-1234567 ext. 12', '053-1234567 x12', '053-1234567 #12', '053-1234567 extension 12', '053-1234567, ext 12', '053-1234567 שלוחה 12'])(
    '%s: valid, extension reported and ignored in E.164',
    (s) => {
      const r = phone(s);
      expect(r, s).toMatchObject({ valid: true, normalized: '+972531234567', warnings: ['EXTENSION_IGNORED'] });
      expect(r.details).toMatchObject({ extension: '12' });
    },
  );

  it('splitExtension separates the trailing extension only', () => {
    expect(splitExtension('03-1234567 ext 5')).toEqual({ body: '03-1234567', extension: '5' });
    expect(splitExtension('03-1234567')).toEqual({ body: '03-1234567', extension: null });
    expect(splitExtension('x12')).toEqual({ body: '', extension: '12' });
    expect(splitExtension('03-1234567 ext 1234567')).toEqual({ body: '03-1234567 ext 1234567', extension: null }); // 7-digit "extension" is not one
  });
});

describe('numbers of other countries', () => {
  it.each([
    ['+44 20 7946 0958', 'GB'],
    ['+1 202 555 0143', 'US'],
    ['+33 1 23 45 67 89', 'FR'],
  ])('%s is a valid %s number but not Israeli', (input, country) => {
    const r = phone(input);
    if (r.reasonCode === 'NOT_ISRAELI') {
      expect(r).toMatchObject({ valid: false, normalized: null, details: null });
      expect(r.reason).toContain(country);
    } else {
      // "+33 1 23 45 67 89" may not be a valid French number: then it is simply not valid
      expect(r.valid).toBe(false);
    }
  });

  it('is NOT_ISRAELI for the well-formed ones', () => {
    expect(phone('+442079460958')).toMatchObject({ valid: false, reasonCode: 'NOT_ISRAELI' });
    expect(phone('+12025550143')).toMatchObject({ valid: false, reasonCode: 'NOT_ISRAELI' });
  });
});

describe('rejections', () => {
  it.each([
    ['too short', '053-123', 'WRONG_LENGTH'],
    ['just the trunk prefix', '0', 'WRONG_LENGTH'],
    ['too long', '05312345678901234567890', 'WRONG_LENGTH'],
    ['one digit too many', '+9725312345678', 'WRONG_LENGTH'],
    ['one digit too few', '053-123456', 'WRONG_LENGTH'],
    ['letters', 'call me', 'INVALID_CHARACTERS'],
    ['letters inside', '053-12ab567', 'INVALID_CHARACTERS'],
    ['an email', 'a@b.co', 'INVALID_CHARACTERS'],
    ['empty', '', 'EMPTY'],
    ['only an extension', 'ext 12', 'EMPTY'],
  ])('%s', (_name, input, code) => {
    const r = phone(input);
    expect(r).toMatchObject({ valid: false, reasonCode: code, normalized: null, details: null });
  });

  it('a lone plus or double plus is unreadable', () => {
    expect(phone('+').valid).toBe(false);
    expect(phone('++972531234567')).toMatchObject({ valid: false });
  });

  it('short service codes are not phone numbers', () => {
    for (const s of ['*2345', '101', '100']) expect(phone(s).valid).toBe(false);
  });
});

describe('invisible marks and other digit scripts must be cleaned first (checkValue does that; this checker is strict about them)', () => {
  it('rejects RLM marks and Arabic-Indic digits when called directly', () => {
    expect(phone(`${RLM}053-1234567`)).toMatchObject({ valid: false, reasonCode: 'INVALID_CHARACTERS' });
    expect(phone(toArabicIndic('053-1234567')).valid).toBe(false);
    expect(phone(toPersian('053-1234567')).valid).toBe(false);
    expect(phone(`053-1234567${LRM}`).valid).toBe(false);
    expect(phone(`${ALM}0531234567`).valid).toBe(false);
  });
});

describe('strict mode (normalize = false): E.164 only', () => {
  it('accepts the canonical form', () => {
    expect(phone('+972531234567', false)).toMatchObject({ valid: true, normalized: '+972531234567' });
  });
  it.each(['0531234567', '053-1234567', '972531234567', '+972 53 123 4567', '+9720531234567'])('rejects %s', (s) => {
    expect(phone(s, false)).toMatchObject({ valid: false, reasonCode: 'BAD_FORMAT' });
  });
  it('the canonical-form message says what the number would be', () => {
    expect(phone('+9720531234567', false).reason).toContain('+972531234567');
  });
});

describe('never throws', () => {
  it('for 3,000 random digit strings of any length, with and without a plus', () => {
    const rnd = mulberry32(8);
    for (let i = 0; i < 3_000; i++) {
      const s = (rnd() < 0.5 ? '+' : '') + randomDigits(rnd, Math.floor(rnd() * 25));
      expect(() => phone(s)).not.toThrow();
      expect(() => phone(s, false)).not.toThrow();
    }
  });
});
