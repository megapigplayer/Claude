import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Location } from '@hebcal/core';
import { buildRowsForLocation } from '../src/lib/batch.js';
import { DEFAULT_HAVDALAH_DEG } from '../src/lib/week.js';
import type { WeekOptions } from '../src/lib/week.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const inputSchema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8')) as { properties: Record<string, unknown> };

function jsonBlocks(): unknown[] {
  return [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] as string) as unknown);
}

describe('README', () => {
  it('the input example only uses real input_schema.json fields', () => {
    const blocks = jsonBlocks() as Array<Record<string, unknown>>;
    const input = blocks.find((b) => 'locations' in b);
    expect(input, 'input example').toBeDefined();
    for (const key of Object.keys(input as object)) expect(Object.keys(inputSchema.properties)).toContain(key);
  });

  it('the output example keys match the real output row keys exactly', () => {
    const blocks = jsonBlocks() as Array<Record<string, unknown>>;
    const output = blocks.find((b) => 'candleLighting' in b);
    expect(output, 'output example').toBeDefined();
    const options: WeekOptions = {
      candleLightingMinutes: null,
      havdalahMinutes: null,
      havdalahDeg: DEFAULT_HAVDALAH_DEG,
      includeShabbat: true,
      includeZmanim: false,
      includeHolidays: false,
      useElevation: true,
    };
    const [real] = buildRowsForLocation({ input: 'Jerusalem', position: 1, raw: 'Jerusalem' }, { year: 2026, month: 10, day: 9 }, 1, options);
    expect(Object.keys(output as object)).toEqual(Object.keys(real as object));
  });

  it('lists Location.lookup city names it claims exist', () => {
    for (const city of ['Jerusalem', 'Tel Aviv', 'Haifa', 'New York', 'London', 'Sydney']) {
      expect(Location.lookup(city), city).toBeDefined();
    }
  });

  it('documents the price and the SEO terms from TOP60.md', () => {
    expect(readme).toMatch(/\$0\.01/);
    expect(readme).toMatch(/Shabbat times API/);
    expect(readme).toMatch(/candle lighting times by city/);
    expect(readme).toMatch(/zmanim API/);
    expect(readme).toMatch(/זמני שבת/);
  });
});
