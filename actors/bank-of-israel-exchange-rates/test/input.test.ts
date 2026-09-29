import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT, DEFAULT_MAX_ITEMS, InputError, MAX_ITEMS_LIMIT, normalizeInput, resolveDataSource } from '../src/lib/input.js';
import { RATE_RULES } from '../src/lib/rates.js';

const schema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8')) as {
  properties: Record<string, { prefill?: unknown; default?: unknown; maximum?: number; pattern?: string; enum?: string[] }>;
  required?: string[];
};

describe('normalizeInput: demo fallback (the platform daily run must never fail)', () => {
  it('uses the demo input for null, undefined, {} and defaults-only input', () => {
    expect(normalizeInput(null)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput(undefined)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput({})).toEqual(DEFAULT_INPUT);
    expect(normalizeInput({ rateRule: 'last-published-on-or-before', maxItems: 5000 })).toEqual(DEFAULT_INPUT);
    expect(normalizeInput({ maxItems: 3 })).toEqual({ ...DEFAULT_INPUT, maxItems: 3 });
    expect(normalizeInput({ rateRule: 'same-day' })).toEqual({ ...DEFAULT_INPUT, rateRule: 'same-day' });
    expect(normalizeInput({ dateFrom: '', dateTo: '  ', currencies: null, conversions: null })).toEqual(DEFAULT_INPUT);
  });

  it('the demo is one currency and one fixed recent date (tiny, deterministic, never "today")', () => {
    expect(DEFAULT_INPUT.currencies).toEqual(['USD']);
    expect(DEFAULT_INPUT.dateFrom).toBe(DEFAULT_INPUT.dateTo);
    expect(DEFAULT_INPUT.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(DEFAULT_INPUT.conversions).toEqual([]);
    expect(DEFAULT_INPUT.dataSource).toBeNull(); // fixtures are never selected by the defaults
  });

  it('returns fresh copies (no shared mutable state)', () => {
    normalizeInput(null).currencies.push('EUR');
    expect(normalizeInput(null).currencies).toEqual(['USD']);
  });
});

describe('normalizeInput: real input', () => {
  it('accepts a range for several currencies', () => {
    const input = normalizeInput({ currencies: ['USD', 'eur', ' JPY '], dateFrom: '2025-01-05', dateTo: '2025-01-09', rateRule: 'previous-business-day', maxItems: 100 });
    expect(input).toMatchObject({
      currencies: ['USD', 'eur', 'JPY'],
      dateFrom: '2025-01-05',
      dateTo: '2025-01-09',
      rateRule: 'previous-business-day',
      maxItems: 100,
      conversions: [],
    });
  });

  it('accepts currencies as one text ("USD, EUR;JPY") and drops blanks and non-text entries', () => {
    expect(normalizeInput({ currencies: 'USD, EUR;JPY', dateFrom: '2025-01-05' }).currencies).toEqual(['USD', 'EUR', 'JPY']);
    expect(normalizeInput({ currencies: ['USD', '', '  ', null, 5, {}], dateFrom: '2025-01-05' }).currencies).toEqual(['USD', '5']);
  });

  it('fills partial date input the friendly way: one date = a one-day range, no dates = today', () => {
    expect(normalizeInput({ currencies: ['USD'], dateFrom: '2025-01-05' })).toMatchObject({ dateFrom: '2025-01-05', dateTo: '2025-01-05' });
    expect(normalizeInput({ currencies: ['USD'], dateTo: '2025-01-09' })).toMatchObject({ dateFrom: '2025-01-09', dateTo: '2025-01-09' });
    expect(normalizeInput({ currencies: ['USD'] })).toMatchObject({ dateFrom: 'today', dateTo: 'today' });
    expect(normalizeInput({ currencies: ['USD'], dateFrom: 'Today', dateTo: '2025-01-09' })).toMatchObject({ dateFrom: 'today' });
  });

  it('accepts conversions only (no range) and keeps entries raw for per-item validation', () => {
    const input = normalizeInput({ conversions: [{ amount: 1200, currency: 'USD', date: '2025-01-07' }, 'junk'] });
    expect(input.currencies).toEqual([]);
    expect(input.dateFrom).toBeNull();
    expect(input.conversions).toHaveLength(2);
  });

  it('coerces the rate rule leniently (case, underscores) and defaults it', () => {
    expect(normalizeInput({ currencies: ['USD'], rateRule: 'SAME_DAY' }).rateRule).toBe('same-day');
    expect(normalizeInput({ currencies: ['USD'], rateRule: null }).rateRule).toBe('last-published-on-or-before');
    expect(normalizeInput({ currencies: ['USD'], rateRule: '' }).rateRule).toBe('last-published-on-or-before');
  });

  it('clamps maxItems to the documented limit and floors fractions', () => {
    expect(normalizeInput({ currencies: ['USD'], maxItems: 10_000_000 }).maxItems).toBe(MAX_ITEMS_LIMIT);
    expect(normalizeInput({ currencies: ['USD'], maxItems: 2.9 }).maxItems).toBe(2);
    expect(normalizeInput({ currencies: ['USD'] }).maxItems).toBe(DEFAULT_MAX_ITEMS);
  });

  it('reads the undocumented dataSource switch', () => {
    expect(normalizeInput({ currencies: ['USD'], dataSource: 'live' }).dataSource).toBe('live');
    expect(normalizeInput({ currencies: ['USD'], dataSource: 'fixtures' }).dataSource).toBe('fixtures');
    expect(normalizeInput({ currencies: ['USD'], dataSource: '' }).dataSource).toBeNull();
  });
});

describe('normalizeInput: unusable caller input fails clearly (never runs the demo for a paying user)', () => {
  it('rejects an empty currency list without conversions, and dates without currencies', () => {
    expect(() => normalizeInput({ currencies: [] })).toThrow(InputError);
    expect(() => normalizeInput({ currencies: ['', ' '] })).toThrow(/Nothing to do/);
    expect(() => normalizeInput({ dateFrom: '2025-01-05' })).toThrow(/need at least one currency/);
    expect(() => normalizeInput({ conversions: [] })).toThrow(/Nothing to do/);
  });

  it('rejects wrongly typed fields with a readable message', () => {
    expect(() => normalizeInput('nope')).toThrow(/JSON object/);
    expect(() => normalizeInput([])).toThrow(/JSON object/);
    expect(() => normalizeInput({ currencies: 5 })).toThrow(/"currencies" must be a list/);
    expect(() => normalizeInput({ currencies: ['USD'], conversions: 'x' })).toThrow(/"conversions" must be a list/);
    expect(() => normalizeInput({ currencies: ['USD'], maxItems: 0 })).toThrow(/maxItems/);
    expect(() => normalizeInput({ currencies: ['USD'], maxItems: 'many' })).toThrow(/maxItems/);
    expect(() => normalizeInput({ currencies: ['USD'], rateRule: 'sometimes' })).toThrow(/rateRule.*last-published-on-or-before/);
    expect(() => normalizeInput({ currencies: ['USD'], dataSource: 'mock' })).toThrow(/dataSource/);
  });

  it('rejects unparsable dates and names the field', () => {
    expect(() => normalizeInput({ currencies: ['USD'], dateFrom: '07/01/2025' })).toThrow(/"dateFrom".*ambiguous/);
    expect(() => normalizeInput({ currencies: ['USD'], dateTo: '2025-02-30' })).toThrow(/"dateTo"/);
    expect(() => normalizeInput({ currencies: ['USD'], dateFrom: 20250107 })).toThrow(/"dateFrom"/);
  });

  it('still validates dates when only conversions are given', () => {
    expect(() => normalizeInput({ conversions: [{}], dateFrom: 'garbage' })).toThrow(/"dateFrom"/);
  });
});

describe('resolveDataSource: fixtures can never be the platform default', () => {
  const at = (isAtHome: boolean, inputValue: 'live' | 'fixtures' | null = null, envValue?: string) => resolveDataSource({ inputValue, envValue, isAtHome });

  it('on the Apify platform it is always live', () => {
    expect(at(true)).toMatchObject({ source: 'live' });
    expect(at(true, 'live')).toMatchObject({ source: 'live' });
    expect(at(true, null, 'live')).toMatchObject({ source: 'live' });
  });

  it('on the platform, asking for fixtures (input or environment) is an error', () => {
    expect(() => at(true, 'fixtures')).toThrow(/not available on the Apify platform/);
    expect(() => at(true, null, 'fixtures')).toThrow(InputError);
  });

  it('outside the platform the offline default is fixtures, and live must be asked for explicitly', () => {
    expect(at(false).source).toBe('fixtures');
    expect(at(false).reason).toMatch(/set "dataSource": "live"/);
    expect(at(false, 'live')).toMatchObject({ source: 'live' });
    expect(at(false, null, 'live')).toMatchObject({ source: 'live' });
    expect(at(false, null, ' FIXTURES ')).toMatchObject({ source: 'fixtures' });
  });

  it('the input field wins over the environment variable and a bad environment value is rejected', () => {
    expect(at(false, 'live', 'fixtures').source).toBe('live');
    expect(at(false, null, '').source).toBe('fixtures');
    expect(() => at(false, null, 'maybe')).toThrow(/BOI_DATA_SOURCE/);
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

  it('keeps the daily-test input tiny, without required fields, and without defaults on work-defining fields', () => {
    expect(schema.required ?? []).toEqual([]);
    expect(JSON.stringify(Object.values(schema.properties).map((p) => p.prefill ?? null)).length).toBeLessThan(200);
    for (const key of ['currencies', 'dateFrom', 'dateTo', 'conversions']) expect(schema.properties[key]?.default, key).toBeUndefined();
    expect(schema.properties.maxItems?.maximum).toBe(MAX_ITEMS_LIMIT);
    expect(schema.properties.maxItems?.default).toBe(DEFAULT_MAX_ITEMS);
  });

  it('offers exactly the implemented rate rules and does NOT expose the fixture switch in the public form', () => {
    expect(schema.properties.rateRule?.enum).toEqual([...RATE_RULES]);
    expect(Object.keys(schema.properties)).not.toContain('dataSource');
  });

  it('the date pattern accepts the prefill, "today" and datetimes, and rejects ambiguous formats', () => {
    const pattern = new RegExp(schema.properties.dateFrom?.pattern as string);
    expect(schema.properties.dateTo?.pattern).toBe(schema.properties.dateFrom?.pattern);
    for (const ok of ['2026-09-23', ' 2025-01-07 ', 'today', 'Today', '2025-01-07T00:00:00Z']) expect(pattern.test(ok), ok).toBe(true);
    for (const bad of ['07/01/2025', '7.1.2025', '2025-1-7', 'tomorrow', '']) expect(pattern.test(bad), bad).toBe(false);
  });
});
