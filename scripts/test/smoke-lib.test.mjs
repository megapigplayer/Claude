import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { estimateCost, inputFromSchema, isSubset, readLocalDataset } from '../lib/smoke.mjs';

test('isSubset: partial deep match', () => {
  assert.ok(isSubset({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(isSubset({ a: { b: [1, 2] } }, { a: { b: [1, 2], c: 3 } }));
  assert.ok(!isSubset({ a: 1 }, { a: 2 }));
  assert.ok(!isSubset({ a: 1 }, undefined));
  assert.ok(!isSubset({ a: [1] }, { a: [1, 2] }));
  assert.ok(isSubset({ a: null }, { a: null }));
});

test('inputFromSchema: prefill wins over default; fields without either are omitted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-'));
  try {
    mkdirSync(join(dir, '.actor'));
    writeFileSync(join(dir, '.actor', 'input_schema.json'), JSON.stringify({
      title: 't', type: 'object', schemaVersion: 1,
      properties: { a: { prefill: 1, default: 2 }, b: { default: 3 }, c: { title: 'none' } },
    }));
    assert.deepEqual(inputFromSchema(dir), { a: 1, b: 3 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readLocalDataset reads *.json rows in order and ignores metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-'));
  try {
    const d = join(dir, 'datasets', 'default');
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, '000000002.json'), '{"n":2}');
    writeFileSync(join(d, '000000001.json'), '{"n":1}');
    writeFileSync(join(d, '__metadata__.json'), '{"meta":true}');
    assert.deepEqual(readLocalDataset(dir), [{ n: 1 }, { n: 2 }]);
    assert.deepEqual(readLocalDataset(dir, 'charging_log'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('estimateCost: compute-unit arithmetic and price ratio', () => {
  // 256 MB for 36 s = 0.25 GB * 0.01 h = 0.0025 CU; at $0.4/CU = $0.001 per run; 10 events => $0.0001 each
  const c = estimateCost({ wallMs: 36_000, maxRssKb: 102_400, allocatedMb: 256, cuUsd: 0.4, events: 10, priceUsd: 0.002 });
  assert.ok(Math.abs(c.runCostUsd - 0.001) < 1e-12);
  assert.ok(Math.abs(c.perEventUsd - 0.0001) < 1e-12);
  assert.ok(Math.abs(c.priceToCostRatio - 20) < 1e-9);
  assert.equal(c.peakRssMb, 100);
});
