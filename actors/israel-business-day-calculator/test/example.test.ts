import { describe, expect, it } from 'vitest';
import { processItem } from '../src/lib/example.js';

describe('processItem', () => {
  it('uppercases a valid string', () => {
    const result = processItem('hello');
    expect(result).toEqual({ input: 'hello', ok: true, value: 'HELLO', error: null });
  });

  it('trims before uppercasing', () => {
    const result = processItem('  hello  ');
    expect(result.ok).toBe(true);
    expect(result.value).toBe('HELLO');
  });

  it('rejects an empty string without throwing', () => {
    const result = processItem('   ');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/non-empty/);
  });

  it('rejects a non-string without throwing', () => {
    const result = processItem(42);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
