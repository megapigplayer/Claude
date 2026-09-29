import { describe, expect, it } from 'vitest';
import { cleanInput, firstDisallowed, isBlank, NUMERIC_SEPARATORS } from '../src/lib/text.js';
import {
  ALM, BOM, EN_DASH, IDEOGRAPHIC_SPACE, LRE, LRI, LRM, LRO, MINUS_SIGN, NARROW_NBSP, NB_HYPHEN, NBSP, PDF, PDI, RLE, RLI, RLM, RLO, SOFT_HYPHEN, WORD_JOINER, ZWJ, ZWNJ, ZWSP,
  toArabicIndic, toFullWidth, toPersian,
} from './helpers.js';

describe('cleanInput (normalize = true)', () => {
  it('leaves clean ASCII alone and trims the ends', () => {
    expect(cleanInput('  123456782  ', true)).toEqual({ text: '123456782', warnings: [] });
  });

  it.each([
    ['LRM/RLM', `${RLM}123456782${LRM}`],
    ['ALM', `${ALM}123456782`],
    ['embeddings and overrides', `${LRE}${RLE}${LRO}${RLO}123456782${PDF}`],
    ['isolates', `${LRI}${RLI}123456782${PDI}`],
    ['zero-width space / joiners', `123${ZWSP}456${ZWNJ}78${ZWJ}2`],
    ['word joiner and BOM', `${BOM}123456782${WORD_JOINER}`],
    ['soft hyphen', `123${SOFT_HYPHEN}456782`],
  ])('removes invisible characters: %s', (_name, input) => {
    const out = cleanInput(input, true);
    expect(out.text).toBe('123456782');
    expect(out.warnings).toEqual(['INVISIBLE_CHARACTERS_REMOVED']);
  });

  it('converts Arabic-Indic digits', () => {
    expect(cleanInput(toArabicIndic('123456782'), true)).toEqual({ text: '123456782', warnings: ['NON_ASCII_DIGITS_CONVERTED'] });
  });

  it('converts Persian (extended Arabic-Indic) digits', () => {
    expect(cleanInput(toPersian('050-1234567'), true)).toEqual({ text: '050-1234567', warnings: ['NON_ASCII_DIGITS_CONVERTED'] });
  });

  it('converts full-width digits and turns exotic spaces into plain ones (NFKC)', () => {
    expect(cleanInput(toFullWidth('123456782'), true)).toEqual({ text: '123456782', warnings: ['NON_ASCII_DIGITS_CONVERTED'] });
    expect(cleanInput(`1${NBSP}2${NARROW_NBSP}3${IDEOGRAPHIC_SPACE}4`, true).text).toBe('1 2 3 4');
  });

  it('mixes: invisible marks around Arabic-Indic digits report both warnings', () => {
    const out = cleanInput(`${RLM}${toArabicIndic('034567891')}${LRM}`, true);
    expect(out.text).toBe('034567891');
    expect(out.warnings).toEqual(['INVISIBLE_CHARACTERS_REMOVED', 'NON_ASCII_DIGITS_CONVERTED']);
  });

  it('does not touch Hebrew letters or Latin text', () => {
    expect(cleanInput('ת.ז. 123456782 ID', true).text).toBe('ת.ז. 123456782 ID');
  });

  it('survives non-string input', () => {
    expect(cleanInput(undefined as unknown as string, true).text).toBe('');
    expect(cleanInput(null as unknown as string, true).text).toBe('');
    expect(cleanInput(123 as unknown as string, true).text).toBe('123');
  });
});

describe('cleanInput (strict, normalize = false)', () => {
  it('only trims', () => {
    expect(cleanInput(`  ${RLM}123456782 `, false).text).toBe(`${RLM}123456782`);
    expect(cleanInput(toArabicIndic('123'), false).warnings).toEqual([]);
  });
});

describe('isBlank', () => {
  it.each(['', '   ', '\t\n', ZWSP, `${RLM}${LRM}`, ` ${BOM} `, NBSP])('blank: %j', (s) => {
    expect(isBlank(s)).toBe(true);
  });
  it.each(['0', 'a', ' 1 ', `${RLM}5`])('not blank: %j', (s) => {
    expect(isBlank(s)).toBe(false);
  });
});

describe('NUMERIC_SEPARATORS', () => {
  it('removes spaces, dots and every kind of dash', () => {
    const dirty = `1 2.3-4${EN_DASH}5${NB_HYPHEN}6${MINUS_SIGN}7`;
    expect(dirty.replace(NUMERIC_SEPARATORS, '')).toBe('1234567');
  });
  it('keeps letters, plus signs and slashes', () => {
    expect('+12/ab'.replace(NUMERIC_SEPARATORS, '')).toBe('+12/ab');
  });
});

describe('firstDisallowed', () => {
  it('returns the first offending character, printable', () => {
    expect(firstDisallowed('12a45', /[0-9]/)).toBe('"a"');
    expect(firstDisallowed('12345', /[0-9]/)).toBeNull();
    expect(firstDisallowed('1\u{1F600}', /[0-9]/u)).toBe('"\u{1F600}"');
  });
});
