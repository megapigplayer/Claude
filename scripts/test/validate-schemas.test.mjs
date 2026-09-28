import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT, TEMPLATES_DIR } from '../lib/common.mjs';
import { validateSchemas } from '../lib/validate-schemas.mjs';

// These tests need the official validators (root devDependencies); skip cleanly if not installed yet.
const haveCli = existsSync(join(REPO_ROOT, 'node_modules', '.bin', 'apify'));
const opts = { skip: haveCli ? false : 'apify-cli is not installed (run npm install)' };

async function run(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'schema-'));
  try {
    cpSync(join(TEMPLATES_DIR, 'actor-ts', '.actor'), join(dir, '.actor'), { recursive: true });
    mutate(dir);
    return await validateSchemas({ dir });
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

test('the template schemas pass the official validators', opts, async () => {
  const r = await run(() => {});
  assert.deepEqual(r.problems, []);
});

test('a prefill of the wrong type is rejected by apify validate-schema', opts, async () => {
  const r = await run((d) => editJson(d, '.actor/input_schema.json', (j) => { j.properties.items.prefill = 'not-an-array'; }));
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /apify validate-schema failed/);
});

test('an actor.json without a name is rejected by the official actor schema', opts, async () => {
  const r = await run((d) => editJson(d, '.actor/actor.json', (j) => { delete j.name; }));
  assert.ok(r.problems.some((p) => /official schema/.test(p)), r.problems.join('\n'));
});
