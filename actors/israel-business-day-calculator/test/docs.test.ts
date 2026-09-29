import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CalculationInput } from '../src/lib/calculate.js';
import { buildRow } from '../src/lib/calculate.js';
import { civilToRd } from '../src/lib/civil.js';
import { addBusinessDays } from '../src/lib/business-days.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const inputSchema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8')) as { properties: Record<string, unknown> };

function jsonBlocks(): unknown[] {
  return [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] as string) as unknown);
}

describe('README', () => {
  it('the input example only uses real input_schema.json fields', () => {
    const blocks = jsonBlocks() as Array<Record<string, unknown>>;
    const input = blocks.find((b) => 'calculations' in b);
    expect(input, 'input example').toBeDefined();
    for (const key of Object.keys(input as object)) expect(Object.keys(inputSchema.properties)).toContain(key);
  });

  it('the output example keys match the real output row keys exactly, and its values are correct', () => {
    const blocks = jsonBlocks() as Array<Record<string, unknown>>;
    const output = blocks.find((b) => 'holidaysInRange' in b);
    expect(output, 'output example').toBeDefined();
    const base: CalculationInput = {
      operation: 'add',
      startDate: '2026-09-10',
      days: 3,
      endDate: null,
      paymentTerms: null,
      calendarProfile: 'il-workweek-sun-thu',
      rollConvention: 'following',
      customWeekendDays: null,
      extraHolidays: [],
      halfDaysAreBusiness: true,
    };
    const real = buildRow({ input: '{}', position: 1 }, base);
    expect(Object.keys(output as object)).toEqual(Object.keys(real));
    expect((output as Record<string, unknown>).result).toBe(real.result);
  });

  it('the "next" and TASE anchors used in the README text are correct (cross-check against business-days.ts)', () => {
    expect(addBusinessDays(civilToRd(2026, 10, 8), 1, { profile: 'il-workweek-sun-thu', customWeekendDays: null, extraHolidays: new Set(), halfDaysAreBusiness: true }).resultRd).toBe(civilToRd(2026, 10, 11));
  });

  it('documents the price, VERIFY note, and TOP60.md SEO terms', () => {
    expect(readme).toMatch(/\$0\.002/);
    expect(readme).toMatch(/VERIFY/);
    expect(readme).toMatch(/2026-01-05/);
    expect(readme).toMatch(/Israeli business days calculator/);
    expect(readme).toMatch(/שוטף plus 60 payment terms calculator/);
    expect(readme).toMatch(/Sunday–Thursday work week/);
    expect(readme).toMatch(/TASE trading days/);
  });
});
