import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Small seeded PRNG so every "random" test is reproducible. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FIXTURES = fileURLToPath(new URL('./fixtures/boi/', import.meta.url));

export function fixture(relativePath: string): string {
  return readFileSync(`${FIXTURES}${relativePath}`, 'utf8');
}
