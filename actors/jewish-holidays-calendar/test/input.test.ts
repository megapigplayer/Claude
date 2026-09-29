import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT, InputError, normalizeInput } from '../src/lib/input.js';

const schemaPath = fileURLToPath(new URL('../.actor/input_schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  properties: Record<string, { prefill?: unknown; default?: unknown }>;
};

describe('normalizeInput: demo fallback', () => {
  it('null, undefined and {} all fall back to DEFAULT_INPUT', () => {
    expect(normalizeInput(null)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput(undefined)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput({})).toEqual(DEFAULT_INPUT);
  });

  it('returns a fresh copy (no shared mutable state across calls)', () => {
    const a = normalizeInput(null);
    a.include.push('modern');
    expect(normalizeInput(null).include).toEqual(DEFAULT_INPUT.include);
  });

  it('a run with only one field set still fills in the rest of the demo', () => {
    expect(normalizeInput({ location: 'diaspora' })).toEqual({ ...DEFAULT_INPUT, location: 'diaspora' });
  });
});

describe('normalizeInput: year', () => {
  it('accepts a number or a numeric string', () => {
    expect(normalizeInput({ year: 2030 }).year).toBe(2030);
    expect(normalizeInput({ year: '2030' }).year).toBe(2030);
  });

  it('rejects a non-integer, out-of-range, or non-numeric year', () => {
    expect(() => normalizeInput({ year: 2026.5 })).toThrow(InputError);
    expect(() => normalizeInput({ year: 0 })).toThrow(InputError);
    expect(() => normalizeInput({ year: 10000 })).toThrow(InputError);
    expect(() => normalizeInput({ year: 'abc' })).toThrow(InputError);
  });
});

describe('normalizeInput: enum options', () => {
  it('accepts valid values case-insensitively', () => {
    expect(normalizeInput({ yearType: 'HEBREW' }).yearType).toBe('hebrew');
    expect(normalizeInput({ location: 'Diaspora' }).location).toBe('diaspora');
    expect(normalizeInput({ format: 'CSV' }).format).toBe('csv');
  });

  it('rejects an unknown value with a readable message', () => {
    expect(() => normalizeInput({ yearType: 'julian' })).toThrow(/yearType/);
    expect(() => normalizeInput({ location: 'mars' })).toThrow(InputError);
    expect(() => normalizeInput({ language: 'fr' })).toThrow(InputError);
    expect(() => normalizeInput({ format: 'pdf' })).toThrow(InputError);
  });
});

describe('normalizeInput: include', () => {
  it('accepts a list, case-insensitively, and de-duplicates', () => {
    expect(normalizeInput({ include: ['Major', 'MAJOR', 'fasts'] }).include).toEqual(['major', 'fasts']);
  });

  it('accepts a comma-separated string', () => {
    expect(normalizeInput({ include: 'major,fasts' }).include).toEqual(['major', 'fasts']);
  });

  it('an empty array is valid (produces only the meta row; not an input error)', () => {
    expect(normalizeInput({ include: [] }).include).toEqual([]);
  });

  it('rejects an unknown category name', () => {
    expect(() => normalizeInput({ include: ['major', 'chanukah'] })).toThrow(/unknown category/);
  });

  it('rejects a non-array, non-string value', () => {
    expect(() => normalizeInput({ include: 42 })).toThrow(InputError);
  });
});

describe('normalizeInput: top-level validation', () => {
  it('rejects a non-object input', () => {
    expect(() => normalizeInput('nope')).toThrow(InputError);
    expect(() => normalizeInput([1, 2])).toThrow(InputError);
  });
});

describe('DEFAULT_INPUT vs .actor/input_schema.json (drift guard)', () => {
  it('matches the schema prefill/default values exactly', () => {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const expected = prop.prefill !== undefined ? prop.prefill : prop.default;
      if (expected === undefined) continue;
      expect(DEFAULT_INPUT[key as keyof typeof DEFAULT_INPUT], `default for "${key}"`).toEqual(expected);
    }
  });
});
