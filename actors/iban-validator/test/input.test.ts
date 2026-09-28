import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectRecords, DEFAULT_INPUT, InputError, MAX_ITEMS_LIMIT, normalizeInput } from '../src/lib/input.js';

const schema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8')) as {
  properties: Record<string, { prefill?: unknown; default?: unknown; maximum?: number; minimum?: number }>;
  required?: string[];
};
const sampleInput = JSON.parse(readFileSync(new URL('./fixtures/sample-input.json', import.meta.url), 'utf8')) as unknown;

describe('normalizeInput: demo fallback (the platform health run must never fail)', () => {
  it('uses the demo input for null, undefined, {} and defaults-only input', () => {
    expect(normalizeInput(null)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput(undefined)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput({})).toEqual(DEFAULT_INPUT);
    expect(normalizeInput({ maxItems: 10000 })).toEqual(DEFAULT_INPUT);
    expect(normalizeInput({ maxItems: 3 })).toEqual({ ...DEFAULT_INPUT, maxItems: 3 });
  });

  it('returns fresh copies (no shared mutable state)', () => {
    normalizeInput(null).ibans.push('mutated');
    expect(normalizeInput(null).ibans).toEqual(DEFAULT_INPUT.ibans);
  });
});

describe('normalizeInput: real input', () => {
  it('accepts the sample fixture', () => {
    expect(normalizeInput(sampleInput)).toEqual({
      ibans: ['GB82 WEST 1234 5698 7654 32', 'DE89370400440532013001,COBADEFF'],
      csvText: 'iban,bic\nNL91ABNA0417164300,ABNANL2A\nFR1420041010050500013M02606,',
      maxItems: 100,
    });
  });

  it('accepts ibans only, csvText only, or both', () => {
    expect(normalizeInput({ ibans: ['X'] })).toEqual({ ibans: ['X'], csvText: '', maxItems: 10000 });
    expect(normalizeInput({ csvText: 'iban\nX' })).toEqual({ ibans: [], csvText: 'iban\nX', maxItems: 10000 });
    expect(normalizeInput({ ibans: ['A'], csvText: 'B' }).ibans).toEqual(['A']);
  });

  it('coerces odd list elements to strings and lets blank ones be skipped later', () => {
    expect(normalizeInput({ ibans: ['A', 5, null, true] }).ibans).toEqual(['A', '5', '', 'true']);
  });

  it('clamps maxItems to the documented limit and floors fractions', () => {
    expect(normalizeInput({ ibans: ['A'], maxItems: 10_000_000 }).maxItems).toBe(MAX_ITEMS_LIMIT);
    expect(normalizeInput({ ibans: ['A'], maxItems: 2.9 }).maxItems).toBe(2);
  });

  it('does NOT silently run the demo for a caller whose own list is empty or blank', () => {
    expect(() => normalizeInput({ ibans: [] })).toThrow(InputError);
    expect(() => normalizeInput({ ibans: ['', '  '], csvText: '' })).toThrow(/No IBANs found/);
    expect(() => normalizeInput({ csvText: 'iban,bic\n' })).toThrow(InputError);
    expect(() => normalizeInput({ ibans: [], csvText: '\n\n' })).toThrow(InputError);
  });

  it('rejects wrongly typed input with a readable message', () => {
    expect(() => normalizeInput('nope')).toThrow(/JSON object/);
    expect(() => normalizeInput([])).toThrow(/JSON object/);
    expect(() => normalizeInput({ ibans: 'DE89' })).toThrow(/"ibans" must be an array/);
    expect(() => normalizeInput({ csvText: 42 })).toThrow(/"csvText" must be a string/);
    expect(() => normalizeInput({ ibans: ['A'], maxItems: 0 })).toThrow(/maxItems/);
    expect(() => normalizeInput({ ibans: ['A'], maxItems: 'many' })).toThrow(/maxItems/);
    expect(() => normalizeInput({ ibans: ['A'], maxItems: Number.NaN })).toThrow(/maxItems/);
  });
});

describe('collectRecords', () => {
  it('puts the list first, then the CSV rows, with positions per source', () => {
    const c = collectRecords(normalizeInput(sampleInput));
    expect(c.records.map((r) => [r.source, r.position, r.input, r.bic])).toEqual([
      ['ibans', 1, 'GB82 WEST 1234 5698 7654 32', null],
      ['ibans', 2, 'DE89370400440532013001', 'COBADEFF'],
      ['csvText', 1, 'NL91ABNA0417164300', 'ABNANL2A'],
      ['csvText', 2, 'FR1420041010050500013M02606', null],
    ]);
    expect(c.csvHeaderDetected).toBe(true);
    expect(c.skippedBlank).toBe(0);
  });

  it('sums the blank entries of both sources', () => {
    const c = collectRecords({ ibans: ['A', ''], csvText: 'iban\nB\n,\n' });
    expect(c.skippedBlank).toBe(2);
    expect(c.records).toHaveLength(2);
  });
});

describe('DEFAULT_INPUT vs .actor/input_schema.json', () => {
  it('matches the schema prefill/default values exactly (drift guard)', () => {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const expected = prop.prefill !== undefined ? prop.prefill : prop.default;
      if (expected === undefined) continue;
      expect(DEFAULT_INPUT[key as keyof typeof DEFAULT_INPUT], `default for "${key}"`).toEqual(expected);
    }
  });

  it('keeps the daily-test input tiny and free of `required` fields', () => {
    expect(schema.required ?? []).toEqual([]);
    expect(JSON.stringify(schema.properties.ibans?.prefill).length).toBeLessThan(500);
    expect(schema.properties.ibans?.default).toBeUndefined(); // a default would be injected into API runs that only set csvText
    expect(schema.properties.maxItems?.maximum).toBe(MAX_ITEMS_LIMIT);
  });
});
