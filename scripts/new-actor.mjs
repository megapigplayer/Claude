#!/usr/bin/env node
/**
 * Scaffold a new Actor from templates/actor-ts.
 *
 *   node scripts/new-actor.mjs <name> "<Title>"
 *   node scripts/new-actor.mjs iban-validator "IBAN Validator & Normalizer"
 *
 * Copies the template to actors/<name>/ and replaces the __ACTOR_NAME__ / __ACTOR_TITLE__
 * placeholders. Skips build artefacts and lockfiles (the root workspace lockfile is the
 * only lockfile). Set APIFY_TOOLS_ACTORS_DIR to scaffold somewhere else (used by tests).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTOR_NAME_RE, ACTORS_DIR, isMain, TEMPLATES_DIR } from './lib/common.mjs';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'storage', '.git']);
const SKIP_FILES = new Set(['package-lock.json']);

export function validateName(name) {
  if (typeof name !== 'string' || !ACTOR_NAME_RE.test(name)) {
    return 'Name must be kebab-case: lowercase letters, digits and single hyphens (e.g. "iban-validator").';
  }
  if (name.length < 3 || name.length > 63) return 'Name must be 3-63 characters long.';
  return null;
}

export function validateTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') return 'Title must be a non-empty string.';
  if (title.length > 80) return 'Title must be at most 80 characters.';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(title)) return 'Title must not contain control characters or newlines.';
  if (title.includes('*/')) return 'Title must not contain "*/" (it is written into source comments).';
  return null;
}

function fill(text, name, title, isJson) {
  const t = isJson ? JSON.stringify(title).slice(1, -1) : title;
  return text.replaceAll('__ACTOR_NAME__', name).replaceAll('__ACTOR_TITLE__', t);
}

function copyDir(src, dest, name, title, written) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dest, entry);
    if (statSync(from).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      copyDir(from, to, name, title, written);
    } else {
      if (SKIP_FILES.has(entry) || entry.endsWith('.tsbuildinfo')) continue;
      writeFileSync(to, fill(readFileSync(from, 'utf8'), name, title, entry.endsWith('.json')));
      written.push(to);
    }
  }
}

export function scaffoldActor({ name, title, actorsDir = ACTORS_DIR, templateDir = join(TEMPLATES_DIR, 'actor-ts') }) {
  const nameError = validateName(name);
  if (nameError) throw new Error(nameError);
  const titleError = validateTitle(title);
  if (titleError) throw new Error(titleError);
  if (!existsSync(templateDir)) throw new Error(`Template not found: ${templateDir}`);
  const dest = join(actorsDir, name);
  if (existsSync(dest)) throw new Error(`Refusing to overwrite existing folder: ${dest}`);
  const written = [];
  copyDir(templateDir, dest, name, title, written);
  return { dest, written };
}

if (isMain(import.meta.url)) {
  const [name, title] = process.argv.slice(2);
  if (!name || !title || name === '--help' || name === '-h') {
    console.error('Usage: node scripts/new-actor.mjs <name> "<Title>"');
    console.error('Example: node scripts/new-actor.mjs iban-validator "IBAN Validator & Normalizer"');
    process.exit(name === '--help' || name === '-h' ? 0 : 2);
  }
  try {
    const { dest, written } = scaffoldActor({ name, title });
    console.log(`Created ${dest} (${written.length} files).`);
    console.log('\nNext steps:');
    console.log('  1. npm install                       # links the new workspace');
    console.log(`  2. Replace src/lib/example.ts with the real logic (pure functions, no "apify" imports).`);
    console.log(`  3. Edit .actor/input_schema.json (tiny prefill!), src/lib/input.ts (DEFAULT_INPUT must match it),`);
    console.log(`     .actor/dataset_schema.json, pricing.json, README.md, test/smoke.expect.json.`);
    console.log(`  4. node scripts/test-all.mjs --only ${name} --smoke`);
    console.log('  See CONVENTIONS.md for the full quality checklist.');
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
