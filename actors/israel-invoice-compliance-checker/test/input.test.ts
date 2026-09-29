import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT, InputError, normalizeInput } from '../src/lib/input.js';

const schemaPath = fileURLToPath(new URL('../.actor/input_schema.json', import.meta.url));
const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
  properties: Record<string, { prefill?: unknown; default?: unknown }>;
};

describe('normalizeInput', () => {
  it('uses the demo input when there is no INPUT record, or the work-defining field is absent', () => {
    expect(normalizeInput(null)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput(undefined)).toEqual(DEFAULT_INPUT);
    expect(normalizeInput({})).toEqual(DEFAULT_INPUT); // platform health run may pass {}
    expect(normalizeInput({ maxItems: 5 })).toEqual({ ...DEFAULT_INPUT, maxItems: 5 }); // schema defaults only
  });

  it('returns a fresh copy of the defaults (no shared mutable state)', () => {
    const a = normalizeInput(null);
    a.items.push('mutated');
    expect(normalizeInput(null).items).toEqual(DEFAULT_INPUT.items);
  });

  it('accepts a normal input and applies the default maxItems', () => {
    expect(normalizeInput({ items: ['a', 'b'] })).toEqual({ items: ['a', 'b'], maxItems: DEFAULT_INPUT.maxItems });
  });

  it('drops blank strings and non-strings', () => {
    expect(normalizeInput({ items: ['a', '  ', 3, null, 'b'] }).items).toEqual(['a', 'b']);
  });

  it('rejects unusable input with a readable InputError instead of running the demo input', () => {
    expect(() => normalizeInput({ items: [] })).toThrow(InputError);
    expect(() => normalizeInput({ items: ['  '] })).toThrow(/at least one/);
    expect(() => normalizeInput({ items: 'a' })).toThrow(/must be an array/);
    expect(() => normalizeInput('nope')).toThrow(/JSON object/);
    expect(() => normalizeInput({ items: ['a'], maxItems: 0 })).toThrow(/maxItems/);
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
});
