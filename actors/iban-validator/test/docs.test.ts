import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COUNTRIES } from '../src/lib/countries.js';
import { buildRow } from '../src/lib/process.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const inputSchema = JSON.parse(readFileSync(new URL('../.actor/input_schema.json', import.meta.url), 'utf8')) as { properties: Record<string, unknown> };

function jsonBlocks(): unknown[] {
  return [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1] as string) as unknown);
}

describe('README', () => {
  it('lists every supported country with its total length', () => {
    for (const info of Object.values(COUNTRIES)) {
      expect(readme, info.code).toMatch(new RegExp(`\\|\\s*${info.code}\\s*\\|\\s*${info.name.replace(/[()]/g, '\\$&')}\\s*\\|\\s*${info.length}\\s*\\|`));
    }
  });

  it('contains valid JSON examples: one input and one output whose keys match the real output', () => {
    const blocks = jsonBlocks() as Array<Record<string, unknown>>;
    const input = blocks.find((b) => 'ibans' in b);
    expect(input, 'input example').toBeDefined();
    for (const key of Object.keys(input as object)) expect(Object.keys(inputSchema.properties)).toContain(key);
    const output = blocks.find((b) => 'reasonCode' in b);
    expect(output, 'output example').toBeDefined();
    expect(Object.keys(output as object)).toEqual(Object.keys(buildRow({ input: 'X', bic: null, source: 'ibans', position: 1 })));
  });

  it('documents the price and the limits that matter', () => {
    expect(readme).toMatch(/\$0\.002/);
    expect(readme).toMatch(/SWIFT|registry/i);
    expect(readme).toMatch(/not.*(directory|lookup)/i);
  });
});
