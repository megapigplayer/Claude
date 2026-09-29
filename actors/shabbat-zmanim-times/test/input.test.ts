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
    a.locations.push('mutated');
    a.include.push('zmanim');
    expect(normalizeInput(null).locations).toEqual(DEFAULT_INPUT.locations);
    expect(normalizeInput(null).include).toEqual(DEFAULT_INPUT.include);
  });

  it('a run with only one option set still fills in the rest of the demo', () => {
    expect(normalizeInput({ weeks: 3 })).toEqual({ ...DEFAULT_INPUT, weeks: 3 });
  });
});

describe('normalizeInput: locations (work-defining field)', () => {
  it('accepts a normal list', () => {
    expect(normalizeInput({ locations: ['Jerusalem', 'Tel Aviv'] }).locations).toEqual(['Jerusalem', 'Tel Aviv']);
  });

  it('accepts a mix of city-name strings and coordinate objects', () => {
    const custom = { latitude: 41.85, longitude: -87.65, tzid: 'America/Chicago' };
    expect(normalizeInput({ locations: ['Jerusalem', custom] }).locations).toEqual(['Jerusalem', custom]);
  });

  it('a newline-separated string is split into entries', () => {
    expect(normalizeInput({ locations: 'Jerusalem\nTel Aviv' }).locations).toEqual(['Jerusalem', 'Tel Aviv']);
  });

  it('rejects an all-blank locations list (never silently runs the demo for a paying user)', () => {
    expect(() => normalizeInput({ locations: ['', '  ', null] })).toThrow(InputError);
    expect(() => normalizeInput({ locations: [] })).toThrow(/at least one/);
  });

  it('rejects a non-array, non-string locations value', () => {
    expect(() => normalizeInput({ locations: 42 })).toThrow(InputError);
  });
});

describe('normalizeInput: options', () => {
  it('accepts and validates startDate as a plain string (parsed later, in main.ts/batch.ts)', () => {
    expect(normalizeInput({ startDate: '2027-01-01' }).startDate).toBe('2027-01-01');
  });

  it('accepts weeks within range and rejects out of range', () => {
    expect(normalizeInput({ weeks: 10 }).weeks).toBe(10);
    expect(() => normalizeInput({ weeks: 0 })).toThrow(InputError);
    expect(() => normalizeInput({ weeks: 53 })).toThrow(InputError);
  });

  it('include: accepts a list case-insensitively, de-duplicates, and rejects an unknown value', () => {
    expect(normalizeInput({ include: ['Shabbat', 'ZMANIM', 'zmanim'] }).include).toEqual(['shabbat', 'zmanim']);
    expect(() => normalizeInput({ include: ['nope'] })).toThrow(/unknown value/);
  });

  it('candleLightingMinutes / havdalahMinutes are optional integers, null unless given', () => {
    expect(normalizeInput({}).candleLightingMinutes).toBeNull();
    expect(normalizeInput({ candleLightingMinutes: 22.6 }).candleLightingMinutes).toBe(23);
    expect(normalizeInput({ havdalahMinutes: 42 }).havdalahMinutes).toBe(42);
  });

  it('havdalahDeg defaults to 8.5 and is bounded', () => {
    expect(normalizeInput({}).havdalahDeg).toBe(8.5);
    expect(normalizeInput({ havdalahDeg: 7.083 }).havdalahDeg).toBeCloseTo(7.083);
    expect(() => normalizeInput({ havdalahDeg: -1 })).toThrow(InputError);
    expect(() => normalizeInput({ havdalahDeg: 100 })).toThrow(InputError);
  });

  it('rejects a non-object top-level input', () => {
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
