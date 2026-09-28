import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseDelimited, recordsFromCsv, recordsFromList } from '../src/lib/csv.js';

const sampleCsv = readFileSync(new URL('./fixtures/sample.csv', import.meta.url), 'utf8');

describe('detectDelimiter', () => {
  it.each([
    ['a,b,c', ','],
    ['a;b;c', ';'],
    ['a\tb\tc', '\t'],
    ['a|b|c', '|'],
    ['single', ','],
    ['"a,b";c;d', ';'], // commas inside quotes do not count
    ['', ','],
  ])('%j -> %j', (text, expected) => {
    expect(detectDelimiter(text)).toBe(expected);
  });

  it('looks at the first non-empty line only', () => {
    expect(detectDelimiter('\n\niban;bic\nx,y,z,w')).toBe(';');
  });
});

describe('parseDelimited', () => {
  it('parses plain rows with LF, CRLF and CR endings and a trailing newline', () => {
    expect(parseDelimited('a,b\nc,d\n', ',')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseDelimited('a,b\r\nc,d\r\n', ',')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseDelimited('a,b\rc,d', ',')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('handles quotes, escaped quotes, embedded delimiters and embedded newlines', () => {
    expect(parseDelimited('"a,b","c ""q"" d","e\nf"\nx,y,z', ',')).toEqual([['a,b', 'c "q" d', 'e\nf'], ['x', 'y', 'z']]);
  });

  it('drops blank lines but keeps rows that only have an empty first cell plus others', () => {
    expect(parseDelimited('a,b\n\n   \n,x\n', ',')).toEqual([['a', 'b'], ['', 'x']]);
  });

  it('strips a UTF-8 BOM', () => {
    expect(parseDelimited('﻿iban,bic\nX,Y', ',')).toEqual([['iban', 'bic'], ['X', 'Y']]);
  });

  it('is lenient about an unterminated quote (runs to the end)', () => {
    expect(parseDelimited('a,"b\nc', ',')).toEqual([['a', 'b\nc']]);
  });

  it('keeps a quote character that appears mid-field', () => {
    expect(parseDelimited('ab"c,d', ',')).toEqual([['ab"c', 'd']]);
  });

  it('returns nothing for empty input', () => {
    expect(parseDelimited('', ',')).toEqual([]);
    expect(parseDelimited('\n\n', ',')).toEqual([]);
  });
});

describe('recordsFromList', () => {
  it('makes one record per entry, keeping the IBAN cell verbatim', () => {
    const r = recordsFromList(['GB82 WEST 1234 5698 7654 32', ' de89370400440532013000 ']);
    expect(r.records).toEqual([
      { input: 'GB82 WEST 1234 5698 7654 32', bic: null, source: 'ibans', position: 1 },
      { input: ' de89370400440532013000 ', bic: null, source: 'ibans', position: 2 },
    ]);
    expect(r.skippedBlank).toBe(0);
  });

  it.each([
    ['NL91ABNA0417164300,ABNANL2A', 'NL91ABNA0417164300', 'ABNANL2A'],
    ['NL91ABNA0417164300;ABNANL2A', 'NL91ABNA0417164300', 'ABNANL2A'],
    ['NL91ABNA0417164300\tABNANL2A', 'NL91ABNA0417164300', 'ABNANL2A'],
    ['NL91ABNA0417164300|ABNANL2A', 'NL91ABNA0417164300', 'ABNANL2A'],
    ['"NL91 ABNA 0417 1643 00","ABNANL2A"', 'NL91 ABNA 0417 1643 00', 'ABNANL2A'],
    ['NL91ABNA0417164300,', 'NL91ABNA0417164300', null],
  ])('%j -> IBAN + BIC', (entry, iban, bic) => {
    expect(recordsFromList([entry]).records).toEqual([{ input: iban, bic, source: 'ibans', position: 1 }]);
  });

  it('skips and counts blank entries, and numbers only the kept records', () => {
    const r = recordsFromList(['', 'A', '   ', ',BUKBGB22', 'B']);
    expect(r.records.map((x) => [x.input, x.position])).toEqual([['A', 1], ['B', 2]]);
    expect(r.skippedBlank).toBe(3); // '', '   ' and ',BUKBGB22' (no IBAN)
  });

  it('splits an entry that contains several lines into several records', () => {
    const r = recordsFromList(['A\nB,BUKBGB22\n\nC']);
    expect(r.records.map((x) => [x.input, x.bic, x.position])).toEqual([['A', null, 1], ['B', 'BUKBGB22', 2], ['C', null, 3]]);
  });

  it('coerces non-strings instead of throwing', () => {
    expect(() => recordsFromList([null as unknown as string, 42 as unknown as string])).not.toThrow();
    expect(recordsFromList([42 as unknown as string]).records[0]?.input).toBe('42');
  });
});

describe('recordsFromCsv', () => {
  it('uses the "iban" and "bic" header columns and ignores everything else', () => {
    const r = recordsFromCsv(sampleCsv);
    expect(r.headerDetected).toBe(true);
    expect(r.skippedBlank).toBe(1); // customer 1007 has no IBAN
    expect(r.records.map((x) => [x.input, x.bic, x.position])).toEqual([
      ['DE89 3704 0044 0532 0130 00', 'COBADEFFXXX', 1],
      ['GB29NWBK60161331926819', 'NWBKGB2L', 2],
      ['FR1420041010050500013M02606', null, 3],
      ['ES9121000418450200051332', 'CAIXESBBXXX', 4],
      ['DE89370400440532013001', 'COBADEFF', 5],
      ['NL91 ABNA 0417 1643 00', 'ABNANL2A', 6],
    ]);
    expect(r.records.every((x) => x.source === 'csvText')).toBe(true);
  });

  it.each(['iban', 'IBAN', 'IBAN Number', 'iban_code', 'Iban-No.', ' "IBAN" '])('recognises the header %j', (h) => {
    const r = recordsFromCsv(`id,${h}\n1,DE89370400440532013000`);
    expect(r.headerDetected).toBe(true);
    expect(r.records[0]?.input).toBe('DE89370400440532013000');
  });

  it.each(['bic', 'BIC', 'swift', 'SWIFT code', 'BIC/SWIFT', 'swift_bic'])('recognises the BIC header %j', (h) => {
    const r = recordsFromCsv(`${h},iban\nABNANL2A,NL91ABNA0417164300`);
    expect(r.records[0]).toMatchObject({ input: 'NL91ABNA0417164300', bic: 'ABNANL2A' });
  });

  it('works with a header that only has the iban column, and with column order swapped', () => {
    expect(recordsFromCsv('iban\nX1\nX2').records.map((r) => [r.input, r.bic])).toEqual([['X1', null], ['X2', null]]);
    expect(recordsFromCsv('bic;iban\nAAA;X1').records[0]).toMatchObject({ input: 'X1', bic: 'AAA' });
  });

  it('without a header: column 1 is the IBAN, column 2 the BIC', () => {
    const r = recordsFromCsv('NL91ABNA0417164300,ABNANL2A\nDE89370400440532013000\nFR1420041010050500013M02606,');
    expect(r.headerDetected).toBe(false);
    expect(r.records.map((x) => [x.input, x.bic])).toEqual([
      ['NL91ABNA0417164300', 'ABNANL2A'],
      ['DE89370400440532013000', null],
      ['FR1420041010050500013M02606', null],
    ]);
  });

  it('handles semicolon-separated files with CRLF and a BOM', () => {
    const r = recordsFromCsv('﻿iban;bic\r\nNL91ABNA0417164300;ABNANL2A\r\n');
    expect(r.records).toEqual([{ input: 'NL91ABNA0417164300', bic: 'ABNANL2A', source: 'csvText', position: 1 }]);
  });

  it('returns nothing for empty text or a header-only file', () => {
    expect(recordsFromCsv('').records).toEqual([]);
    expect(recordsFromCsv('iban,bic\n').records).toEqual([]);
    expect(recordsFromCsv('iban,bic\n').headerDetected).toBe(true);
  });
});
