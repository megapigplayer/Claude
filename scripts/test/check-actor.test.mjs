import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkActorConventions } from '../lib/check-actor.mjs';
import { TEMPLATES_DIR } from '../lib/common.mjs';

const TEMPLATE = join(TEMPLATES_DIR, 'actor-ts');
const ignoreBuild = (src) => !/[\\/](node_modules|dist|storage)([\\/]|$)/.test(src);

function withCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'chk-'));
  try {
    cpSync(TEMPLATE, dir, { recursive: true, filter: ignoreBuild });
    mutate(dir);
    return checkActorConventions({ dir, kind: 'template', name: 'actor-ts' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const editJson = (dir, rel, fn) => {
  const p = join(dir, rel);
  const j = JSON.parse(readFileSync(p, 'utf8'));
  fn(j);
  writeFileSync(p, JSON.stringify(j, null, 2));
};

test('the template itself satisfies every convention check', () => {
  assert.deepEqual(checkActorConventions({ dir: TEMPLATE, kind: 'template', name: 'actor-ts' }), []);
});

test('detects a price below 5x the estimated cost', () => {
  const problems = withCopy((d) => editJson(d, 'pricing.json', (j) => { j.events['task-completed'].priceUsd = 0.0001; j.events['task-completed'].estimatedCostUsd = 0.0001; }));
  assert.ok(problems.some((p) => /below 5x/.test(p)), problems.join('\n'));
});

test('detects a huge prefill, a missing prefill for a required field and non-camelCase output fields', () => {
  const big = withCopy((d) => editJson(d, '.actor/input_schema.json', (j) => { j.properties.items.prefill = Array.from({ length: 50 }, (_, i) => `x${i}`); }));
  assert.ok(big.some((p) => /more than 20 items/.test(p)), big.join('\n'));
  const noPrefill = withCopy((d) => editJson(d, '.actor/input_schema.json', (j) => { delete j.properties.items.prefill; }));
  assert.ok(noPrefill.some((p) => /at least one property needs a `prefill`/.test(p)), noPrefill.join('\n'));
  const requiredNoPrefill = withCopy((d) => editJson(d, '.actor/input_schema.json', (j) => { j.required = ['items']; delete j.properties.items.prefill; }));
  assert.ok(requiredNoPrefill.some((p) => /required property needs a prefill or default/.test(p)), requiredNoPrefill.join('\n'));
  const snake = withCopy((d) => editJson(d, '.actor/dataset_schema.json', (j) => { j.fields.properties.bad_name = { type: 'string' }; }));
  assert.ok(snake.some((p) => /bad_name.*camelCase/.test(p)), snake.join('\n'));
});

test('detects apify imports in src/lib (except ppe.ts) and cross-folder imports', () => {
  const problems = withCopy((d) => {
    writeFileSync(join(d, 'src/lib/impure.ts'), "import { Actor } from 'apify';\nexport const x = Actor;\n");
    writeFileSync(join(d, 'src/lib/escape.ts'), "import { y } from '../../../other/src/lib/y.js';\nexport const z = y;\n");
  });
  assert.ok(problems.some((p) => /impure\.ts.*must stay pure/.test(p)), problems.join('\n'));
  assert.ok(problems.some((p) => /escape\.ts.*outside the Actor folder/.test(p)), problems.join('\n'));
});

test('detects a local-path dependency and an undeclared PPE event', () => {
  const dep = withCopy((d) => editJson(d, 'package.json', (j) => { j.dependencies.shared = 'file:../../shared'; }));
  assert.ok(dep.some((p) => /local path/.test(p)), dep.join('\n'));
  const ev = withCopy((d) => editJson(d, 'pricing.json', (j) => { delete j.events['task-completed']; j.events.other = { title: 'x', priceUsd: 1, estimatedCostUsd: 0 }; }));
  assert.ok(ev.some((p) => /not declared in pricing\.json/.test(p)), ev.join('\n'));
});

test('detects an actor whose ppe.ts drifted from the template (but allows a different PPE_EVENTS block)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chk-actor-'));
  try {
    cpSync(TEMPLATE, dir, { recursive: true, filter: ignoreBuild });
    // an actor copy: rename events consistently, that alone must be fine
    const ppe = join(dir, 'src/lib/ppe.ts');
    const orig = readFileSync(ppe, 'utf8');
    writeFileSync(ppe, orig.replace("TASK_COMPLETED: 'task-completed'", "THING_DONE: 'thing-done'"));
    editJson(dir, 'pricing.json', (j) => { j.events['thing-done'] = j.events['task-completed']; delete j.events['task-completed']; });
    editJson(dir, 'test/smoke.expect.json', (j) => { j.charge.eventName = 'thing-done'; });
    editJson(dir, 'package.json', (j) => { j.name = 'my-actor'; });
    editJson(dir, '.actor/actor.json', (j) => { j.name = 'my-actor'; });
    const ok = checkActorConventions({ dir, kind: 'actor', name: 'my-actor' });
    assert.ok(!ok.some((p) => /ppe\.ts differs/.test(p)), ok.join('\n'));
    // now really drift the helper
    writeFileSync(ppe, readFileSync(ppe, 'utf8').replace('export function isBudgetExhausted', 'export function isBudgetExhaustedX'));
    const drift = checkActorConventions({ dir, kind: 'actor', name: 'my-actor' });
    assert.ok(drift.some((p) => /ppe\.ts differs/.test(p)), drift.join('\n'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
