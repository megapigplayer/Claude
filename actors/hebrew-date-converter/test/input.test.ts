import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT, InputError, collectRecords, normalizeInput, toConvertOptions } from '../src/lib/input.js';

const schema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8')) as {
  properties: Record<string, { prefill?: unknown; default?: unknown }>;
};

describe('DEFAULT_INPUT matches .actor/input_schema.json prefill/default (CONVENTIONS.md 4.5)', () => {
  it.each(Object.keys(DEFAULT_INPUT))('field "%s"', (key) => {
    if (key === 'anniversaryFrom') {
      expect(DEFAULT_INPUT.anniversaryFrom).toBeNull(); // optional field, no schema default
      return;
    }
    const prop = schema.properties[key];
    expect(prop, `schema must declare "${key}"`).toBeDefined();
    const schemaValue = prop?.prefill !== undefined ? prop.prefill : prop?.default;
    expect(schemaValue).toEqual((DEFAULT_INPUT as unknown as Record<string, unknown>)[key]);
  });
});

describe('normalizeInput: demo fallback (the daily platform test must never fail)', () => {
  it('null, undefined and {} all fall back to the built-in demo input', () => {
    expect(normalizeInput(null)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput(undefined)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput({})).toEqual(DEFAULT_INPUT);
  });

  it('a run with only schema defaults (e.g. maxItems) still demos', () => {
    expect(normalizeInput({ maxItems: 500 })).toEqual({ ...DEFAULT_INPUT, maxItems: 500 });
  });
});

describe('normalizeInput: a caller-supplied but unusable "dates" fails loudly', () => {
  it('an all-blank dates array throws InputError (never silently runs the demo)', () => {
    expect(() => normalizeInput({ dates: ['', '   ', null] })).toThrow(InputError);
  });

  it('dates as a non-array, non-string value is rejected', () => {
    expect(() => normalizeInput({ dates: 42 })).toThrow(InputError);
  });

  it('a newline-separated string is split into entries', () => {
    const input = normalizeInput({ dates: '2026-09-12\n2026-09-28' });
    expect(input.dates).toEqual(['2026-09-12', '2026-09-28']);
  });
});

describe('normalizeInput: option validation', () => {
  it('rejects an unknown enum value with a readable message', () => {
    expect(() => normalizeInput({ direction: 'sideways' })).toThrow(/direction/);
    expect(() => normalizeInput({ language: 'fr' })).toThrow(InputError);
    expect(() => normalizeInput({ schedule: 'mars' })).toThrow(InputError);
  });

  it('accepts enum values case-insensitively', () => {
    expect(normalizeInput({ direction: 'G2H' }).direction).toBe('g2h');
  });

  it('coerces string booleans/numbers leniently', () => {
    expect(normalizeInput({ afterSunset: 'true' }).afterSunset).toBe(true);
    expect(normalizeInput({ maxItems: '50' }).maxItems).toBe(50);
  });

  it('rejects a non-boolean afterSunset', () => {
    expect(() => normalizeInput({ afterSunset: 'maybe' })).toThrow(InputError);
  });

  it('clamps maxItems to the hard limit instead of throwing', () => {
    expect(normalizeInput({ maxItems: 10_000_000 }).maxItems).toBe(100_000);
  });

  it('rejects anniversaryYears above the max instead of clamping (no clamp for that field)', () => {
    expect(() => normalizeInput({ anniversaryYears: 1000 })).toThrow(InputError);
  });

  it('rejects a malformed anniversaryFrom, accepts a valid ISO date, and treats blank as unset', () => {
    expect(() => normalizeInput({ anniversaryFrom: 'not-a-date' })).toThrow(InputError);
    expect(normalizeInput({ anniversaryFrom: '2030-01-01' }).anniversaryFrom).toBe('2030-01-01');
    expect(normalizeInput({ anniversaryFrom: '' }).anniversaryFrom).toBeNull();
  });

  it('rejects a non-object top-level input', () => {
    expect(() => normalizeInput('nope')).toThrow(InputError);
    expect(() => normalizeInput([1, 2])).toThrow(InputError);
  });
});

describe('collectRecords', () => {
  it('skips blank/null entries and counts them, numbering the rest from 1', () => {
    const { records, skippedBlank } = collectRecords({ dates: ['2026-09-12', '', null, '2026-09-28'] });
    expect(skippedBlank).toBe(2);
    expect(records.map((r) => r.position)).toEqual([1, 2]);
    expect(records.map((r) => r.input)).toEqual(['2026-09-12', '2026-09-28']);
  });

  it('echoes an object entry as JSON for the "input" field', () => {
    const { records } = collectRecords({ dates: [{ day: 17, month: 'Tishrei', year: 5787 }] });
    expect(records[0]?.input).toBe('{"day":17,"month":"Tishrei","year":5787}');
  });
});

describe('toConvertOptions', () => {
  it('resolves anniversaryFrom (ISO string) to an R.D. number', () => {
    const options = toConvertOptions({ ...DEFAULT_INPUT, anniversaryFrom: '2030-01-01' });
    expect(options.anniversaryFromRd).not.toBeNull();
  });

  it('leaves anniversaryFromRd null when anniversaryFrom is not set', () => {
    expect(toConvertOptions(DEFAULT_INPUT).anniversaryFromRd).toBeNull();
  });
});
