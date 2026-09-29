import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateCalendar } from '../src/lib/holidays.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const inputSchema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8')) as { properties: Record<string, unknown> };

function jsonBlocks(): unknown[] {
  return [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] as string) as unknown);
}

describe('README', () => {
  it('the input example only uses real input_schema.json fields', () => {
    const blocks = jsonBlocks() as Array<Record<string, unknown>>;
    const input = blocks.find((b) => 'year' in b && 'include' in b);
    expect(input, 'input example').toBeDefined();
    for (const key of Object.keys(input as object)) expect(Object.keys(inputSchema.properties)).toContain(key);
  });

  it('the holiday-row output example keys match the real output row keys exactly', () => {
    const blocks = jsonBlocks() as Array<Record<string, unknown>>;
    const output = blocks.find((b) => b.rowType === 'holiday');
    expect(output, 'holiday output example').toBeDefined();
    const real = generateCalendar({ year: 2026, yearType: 'gregorian', location: 'israel', include: ['major'], language: 'both' })[0];
    expect(Object.keys(output as object)).toEqual(Object.keys(real as object));
  });

  it('the meta-row output example keys match the real meta row exactly', () => {
    const blocks = jsonBlocks() as Array<Record<string, unknown>>;
    const meta = blocks.find((b) => b.rowType === 'meta');
    expect(meta, 'meta output example').toBeDefined();
    const rows = generateCalendar({ year: 2026, yearType: 'gregorian', location: 'israel', include: [], language: 'both' });
    expect(Object.keys(meta as object)).toEqual(Object.keys(rows[0] as object));
  });

  it('documents the price and the nine statutory days', () => {
    expect(readme).toMatch(/\$0\.01/);
    expect(readme).toMatch(/nine statutory/);
  });

  it('mentions the Hebrew-language and SEO terms from TOP60.md', () => {
    expect(readme).toMatch(/Jewish holidays API/);
    expect(readme).toMatch(/Hebrew calendar JSON/);
    expect(readme).toMatch(/Israel public holidays/);
    expect(readme).toMatch(/Rosh Chodesh, Omer, parasha/);
  });
});
