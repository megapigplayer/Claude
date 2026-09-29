import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT, InputError, mergeCalculation, normalizeInput } from '../src/lib/input.js';

const schemaPath = fileURLToPath(new URL('../.actor/input_schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  properties: Record<string, { prefill?: unknown; default?: unknown }>;
};

describe('normalizeInput: demo fallback', () => {
  it('null, undefined and {} all fall back to one demo calculation using DEFAULT_INPUT', () => {
    expect(normalizeInput(null)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput(undefined)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput({})).toEqual(DEFAULT_INPUT);
  });

  it('returns a fresh copy (no shared mutable state)', () => {
    const a = normalizeInput(null);
    a.calculations.push({ operation: 'next' });
    expect(normalizeInput(null).calculations).toEqual(DEFAULT_INPUT.calculations);
  });

  it('setting only top-level fields (no "calculations") still runs one calculation with them', () => {
    const r = normalizeInput({ days: 10 });
    expect(r.calculations).toEqual([{}]);
    expect(r.days).toBe(10);
  });
});

describe('normalizeInput: calculations (work-defining field)', () => {
  it('accepts a list of override objects', () => {
    const r = normalizeInput({ calculations: [{ operation: 'next' }, { operation: 'is-business-day', startDate: '2026-01-01' }] });
    expect(r.calculations).toHaveLength(2);
  });

  it('rejects an empty calculations array (never silently runs the demo for a paying user)', () => {
    expect(() => normalizeInput({ calculations: [] })).toThrow(InputError);
    expect(() => normalizeInput({ calculations: [] })).toThrow(/empty/i);
  });

  it('rejects a non-array calculations value', () => {
    expect(() => normalizeInput({ calculations: 'nope' })).toThrow(InputError);
  });

  it('rejects more than MAX_CALCULATIONS entries', () => {
    expect(() => normalizeInput({ calculations: Array.from({ length: 10_001 }, () => ({})) })).toThrow(/maximum/);
  });
});

describe('normalizeInput: top-level option validation', () => {
  it('validates operation/calendarProfile/rollConvention as enums, case-insensitively', () => {
    expect(normalizeInput({ operation: 'NEXT' }).operation).toBe('next');
    expect(() => normalizeInput({ operation: 'multiply' })).toThrow(InputError);
    expect(() => normalizeInput({ calendarProfile: 'nope' })).toThrow(InputError);
    expect(() => normalizeInput({ rollConvention: 'nope' })).toThrow(InputError);
  });

  it('days accepts negative values and rejects out-of-range/non-numeric', () => {
    expect(normalizeInput({ days: -5 }).days).toBe(-5);
    expect(() => normalizeInput({ days: 'many' })).toThrow(InputError);
    expect(() => normalizeInput({ days: 200_000 })).toThrow(InputError);
  });

  it('extraHolidays validates ISO dates and accepts a newline-separated string', () => {
    expect(normalizeInput({ extraHolidays: ['2026-04-22', '2026-04-23'] }).extraHolidays).toEqual(['2026-04-22', '2026-04-23']);
    expect(normalizeInput({ extraHolidays: '2026-04-22\n2026-04-23' }).extraHolidays).toEqual(['2026-04-22', '2026-04-23']);
    expect(() => normalizeInput({ extraHolidays: ['22/4/2026'] })).toThrow(InputError);
  });

  it('customWeekendDays validates weekday numbers 0-6, de-duplicates and sorts', () => {
    expect(normalizeInput({ customWeekendDays: [6, 0, 0] }).customWeekendDays).toEqual([0, 6]);
    expect(() => normalizeInput({ customWeekendDays: [7] })).toThrow(InputError);
    expect(() => normalizeInput({ customWeekendDays: ['fri'] })).toThrow(InputError);
  });

  it('halfDaysAreBusiness coerces string booleans and rejects garbage', () => {
    expect(normalizeInput({ halfDaysAreBusiness: 'false' }).halfDaysAreBusiness).toBe(false);
    expect(() => normalizeInput({ halfDaysAreBusiness: 'maybe' })).toThrow(InputError);
  });

  it('rejects a non-object top-level input', () => {
    expect(() => normalizeInput('nope')).toThrow(InputError);
    expect(() => normalizeInput([1, 2])).toThrow(InputError);
  });
});

describe('mergeCalculation', () => {
  const topLevel = { ...DEFAULT_INPUT, calculations: undefined } as never;

  it('an empty object uses every top-level default', () => {
    expect(mergeCalculation({}, topLevel)).toEqual({
      operation: DEFAULT_INPUT.operation,
      startDate: DEFAULT_INPUT.startDate,
      days: DEFAULT_INPUT.days,
      endDate: DEFAULT_INPUT.endDate,
      paymentTerms: DEFAULT_INPUT.paymentTerms,
      calendarProfile: DEFAULT_INPUT.calendarProfile,
      rollConvention: DEFAULT_INPUT.rollConvention,
      customWeekendDays: DEFAULT_INPUT.customWeekendDays,
      extraHolidays: DEFAULT_INPUT.extraHolidays,
      halfDaysAreBusiness: DEFAULT_INPUT.halfDaysAreBusiness,
    });
  });

  it("overrides only the fields it sets", () => {
    const merged = mergeCalculation({ operation: 'next', startDate: '2026-01-01' }, topLevel);
    expect(merged.operation).toBe('next');
    expect(merged.startDate).toBe('2026-01-01');
    expect(merged.calendarProfile).toBe(DEFAULT_INPUT.calendarProfile); // untouched, inherited
  });

  it('rejects a non-object entry', () => {
    expect(() => mergeCalculation('nope', topLevel)).toThrow(InputError);
    expect(() => mergeCalculation(null, topLevel)).toThrow(InputError);
    expect(() => mergeCalculation([1], topLevel)).toThrow(InputError);
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
