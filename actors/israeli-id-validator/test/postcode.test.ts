import { describe, expect, it } from 'vitest';
import { checkPostcode } from '../src/lib/postcode.js';

const pc = (s: string, rejectDummy = true, normalize = true) => checkPostcode(s, rejectDummy, normalize);

describe('valid 7-digit postcodes', () => {
  it.each(['6100000', '9100000', '8800000', '1100000', '3200000', '4020000'])('%s', (s) => {
    expect(pc(s)).toMatchObject({ valid: true, reasonCode: 'OK', normalized: s, details: null, warnings: [] });
  });

  it.each([
    ['61 000 00', '6100000'],
    ['61-000-00', '6100000'],
    ['6100.000', '6100000'],
    [' 6100000 ', '6100000'],
  ])('%j is cleaned to %s', (input, expected) => {
    expect(pc(input.trim() === input ? input : input.trim())).toMatchObject({ valid: true, normalized: expected });
  });

  it('is a format check only and says so', () => {
    expect(pc('6100000').reason).toContain('format check only');
  });
});

describe('wrong length', () => {
  it.each([['6', '1'], ['610000', '6'], ['61000000', '8'], ['', '0']])('%s has %s digits', (s, n) => {
    const r = pc(s);
    if (s === '') expect(r.reasonCode).toBe('EMPTY');
    else {
      expect(r).toMatchObject({ valid: false, reasonCode: 'WRONG_LENGTH', normalized: null });
      expect(r.reason).toContain(`has ${n}`);
    }
  });

  it('the legacy 5-digit postcode is called out', () => {
    const r = pc('91000');
    expect(r).toMatchObject({ valid: false, reasonCode: 'WRONG_LENGTH' });
    expect(r.reason).toContain('legacy');
  });
});

describe('invalid characters', () => {
  it.each(['61A0000', '610000O', 'IL61000', '6100-00x', '6100/000'])('%s', (s) => {
    expect(pc(s)).toMatchObject({ valid: false, reasonCode: 'INVALID_CHARACTERS' });
  });
});

describe('placeholders', () => {
  it.each(['2222222', '0000000', '1111111', '9999999', '1234567', '7654321', '0123456', '3456789'])('%s is DUMMY by default', (s) => {
    expect(pc(s)).toMatchObject({ valid: false, reasonCode: 'DUMMY', warnings: ['DUMMY_PATTERN'] });
  });

  it('with rejectDummy = false they are accepted, with a warning', () => {
    expect(pc('2222222', false)).toMatchObject({ valid: true, reasonCode: 'OK', normalized: '2222222', warnings: ['DUMMY_PATTERN'] });
  });

  it('a check-digit-style pattern is NOT a placeholder for postcodes (no check digit exists)', () => {
    expect(pc('2222227').valid).toBe(true);
  });
});

describe('strict mode', () => {
  it('does not remove separators', () => {
    expect(pc('61 000 00', true, false)).toMatchObject({ valid: false, reasonCode: 'INVALID_CHARACTERS' });
    expect(pc('6100000', true, false).valid).toBe(true);
  });
});
