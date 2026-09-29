import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ConvertOptions } from '../src/lib/convert.js';
import { buildRow } from '../src/lib/convert.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const inputSchema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8')) as { properties: Record<string, unknown> };

function jsonBlocks(): unknown[] {
  return [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] as string) as unknown);
}

const OPTS: ConvertOptions = {
  direction: 'auto',
  afterSunset: false,
  language: 'both',
  mode: 'convert',
  anniversaryYears: 5,
  anniversaryType: 'birthday',
  anniversaryFromRd: null,
  adarRule: 'default',
  schedule: 'israel',
  addTags: true,
};

describe('README', () => {
  it('the input example only uses real input_schema.json fields', () => {
    const blocks = jsonBlocks() as Array<Record<string, unknown>>;
    const input = blocks.find((b) => 'dates' in b);
    expect(input, 'input example').toBeDefined();
    for (const key of Object.keys(input as object)) expect(Object.keys(inputSchema.properties)).toContain(key);
  });

  it('the output example keys match the real output row keys exactly', () => {
    const blocks = jsonBlocks() as Array<Record<string, unknown>>;
    const output = blocks.find((b) => 'hebrewString' in b);
    expect(output, 'output example').toBeDefined();
    const real = buildRow({ input: '2026-09-12', position: 1, raw: '2026-09-12' }, OPTS);
    expect(Object.keys(output as object)).toEqual(Object.keys(real));
  });

  it('documents the price and the key limitations', () => {
    expect(readme).toMatch(/\$0\.002/);
    expect(readme).toMatch(/AMBIGUOUS_ADAR|ambiguous/i);
    expect(readme).toMatch(/rabbi/i);
  });

  it('mentions the Hebrew-language SEO terms from TOP60.md', () => {
    expect(readme).toMatch(/תאריך עברי/);
    expect(readme).toMatch(/yahrzeit/i);
    expect(readme).toMatch(/Gregorian to Hebrew/i);
  });
});
