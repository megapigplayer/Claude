import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { scaffoldActor, validateName, validateTitle } from '../new-actor.mjs';
import { TEMPLATES_DIR } from '../lib/common.mjs';
import { checkActorConventions } from '../lib/check-actor.mjs';

test('validateName / validateTitle', () => {
  assert.equal(validateName('iban-validator'), null);
  for (const bad of ['', 'ab', 'Bad_Name', '-x-', 'a--b', 'x'.repeat(64), 'has space']) assert.ok(validateName(bad), bad);
  assert.equal(validateTitle('IBAN Validator & Normalizer'), null);
  assert.ok(validateTitle('   '));
  assert.ok(validateTitle('bad */ title'));
  assert.ok(validateTitle('two\nlines'));
});

test('scaffoldActor copies the template, fills placeholders, skips build artefacts', () => {
  const actorsDir = mkdtempSync(join(tmpdir(), 'scaffold-'));
  try {
    const { dest } = scaffoldActor({ name: 'demo-actor', title: 'Demo "Quoted" Actor', actorsDir });
    const actorJson = JSON.parse(readFileSync(join(dest, '.actor', 'actor.json'), 'utf8'));
    assert.equal(actorJson.name, 'demo-actor');
    assert.equal(actorJson.title, 'Demo "Quoted" Actor'); // JSON-escaped correctly
    assert.equal(JSON.parse(readFileSync(join(dest, 'package.json'), 'utf8')).name, 'demo-actor');
    assert.match(readFileSync(join(dest, 'README.md'), 'utf8'), /^# Demo "Quoted" Actor/);
    for (const rel of ['src/main.ts', 'src/lib/ppe.ts', 'src/lib/input.ts', 'test/smoke.expect.json', 'Dockerfile', 'pricing.json', '.actorignore']) {
      assert.ok(existsSync(join(dest, rel)), rel);
    }
    assert.ok(!existsSync(join(dest, 'node_modules')));
    assert.ok(!existsSync(join(dest, 'package-lock.json')));
    // no placeholder left anywhere in text files we care about
    for (const rel of ['.actor/actor.json', 'package.json', 'README.md', 'src/main.ts', '.actor/input_schema.json']) {
      assert.ok(!/__ACTOR_(NAME|TITLE)__/.test(readFileSync(join(dest, rel), 'utf8')), rel);
    }
    assert.throws(() => scaffoldActor({ name: 'demo-actor', title: 'x', actorsDir }), /Refusing to overwrite/);
    assert.throws(() => scaffoldActor({ name: 'Bad', title: 'x', actorsDir }), /kebab-case/);
  } finally {
    rmSync(actorsDir, { recursive: true, force: true });
  }
});

test('scaffoldActor never copies node_modules / dist / lockfile from a dirty template', () => {
  const tpl = mkdtempSync(join(tmpdir(), 'tpl-'));
  const actorsDir = mkdtempSync(join(tmpdir(), 'acts-'));
  try {
    mkdirSync(join(tpl, 'node_modules', 'x'), { recursive: true });
    mkdirSync(join(tpl, 'dist'));
    writeFileSync(join(tpl, 'node_modules', 'x', 'i.js'), '1');
    writeFileSync(join(tpl, 'dist', 'main.js'), '1');
    writeFileSync(join(tpl, 'package-lock.json'), '{}');
    writeFileSync(join(tpl, 'package.json'), '{"name":"__ACTOR_NAME__"}');
    const { dest } = scaffoldActor({ name: 'clean-copy', title: 'T', actorsDir, templateDir: tpl });
    assert.ok(existsSync(join(dest, 'package.json')));
    assert.ok(!existsSync(join(dest, 'node_modules')) && !existsSync(join(dest, 'dist')) && !existsSync(join(dest, 'package-lock.json')));
  } finally {
    rmSync(tpl, { recursive: true, force: true });
    rmSync(actorsDir, { recursive: true, force: true });
  }
  assert.ok(existsSync(TEMPLATES_DIR));
});

test('a freshly scaffolded actor is flagged until every template placeholder is replaced', () => {
  const actorsDir = mkdtempSync(join(tmpdir(), 'fresh-'));
  try {
    const { dest } = scaffoldActor({ name: 'fresh-actor', title: 'Fresh Actor', actorsDir });
    const problems = checkActorConventions({ dir: dest, kind: 'actor', name: 'fresh-actor' });
    for (const expected of [/README\.md: still contains template placeholder/, /description is still the template placeholder/, /needs a real costBasis/, /example\.ts is the template's demo logic/]) {
      assert.ok(problems.some((p) => expected.test(p)), `${expected}\n${problems.join('\n')}`);
    }
  } finally {
    rmSync(actorsDir, { recursive: true, force: true });
  }
});
