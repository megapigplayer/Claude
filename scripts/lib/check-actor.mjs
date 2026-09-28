/**
 * Static, offline checks that enforce the mechanical parts of CONVENTIONS.md on one
 * Actor (or the template) folder. Returns a list of human-readable problems (empty = ok).
 * Judgement calls (legal basis, README quality, real cost measurement) stay manual.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { ACTOR_NAME_RE, readJson, TEMPLATES_DIR } from './common.mjs';

const REQUIRED_FILES = [
  '.actor/actor.json',
  '.actor/input_schema.json',
  'Dockerfile',
  'package.json',
  'tsconfig.json',
  'tsconfig.test.json',
  'README.md',
  'pricing.json',
  'src/main.ts',
  'src/lib/ppe.ts',
  'test/smoke.expect.json',
];

const README_SECTIONS = [
  ['who it\'s for', /^#{2,3}\s+.*\bwho\b.*\bfor\b/im],
  ['input', /^#{2,3}\s+.*\binput\b/im],
  ['output', /^#{2,3}\s+.*\boutput\b/im],
  ['pricing', /^#{2,3}\s+.*\bpric(e|ing)\b/im],
  ['limitations', /^#{2,3}\s+.*\blimitations?\b/im],
];

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/;
const MAX_DEFAULT_JSON_CHARS = 2000;
const MAX_DEFAULT_ARRAY_ITEMS = 20;

function listFiles(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

function tryJson(dir, rel, add) {
  const p = join(dir, rel);
  if (!existsSync(p)) return null;
  try {
    return readJson(p);
  } catch (err) {
    add(`${rel}: invalid JSON (${err.message})`);
    return null;
  }
}

export function checkActorConventions({ dir: dirArg, kind, name }) {
  const dir = resolve(dirArg); // absolute, so relative imports can be compared against it
  const problems = [];
  const add = (m) => problems.push(m);
  const isTemplate = kind === 'template';

  for (const rel of REQUIRED_FILES) {
    if (!existsSync(join(dir, rel))) add(`missing required file: ${rel}`);
  }

  // ---- package.json ------------------------------------------------------------------
  const pkg = tryJson(dir, 'package.json', add);
  if (pkg) {
    if (pkg.type !== 'module') add('package.json: "type" must be "module"');
    for (const s of ['build', 'typecheck', 'test', 'start']) {
      if (!pkg.scripts?.[s]) add(`package.json: missing script "${s}"`);
    }
    if (!pkg.dependencies?.apify) add('package.json: "apify" must be a dependency');
    for (const section of ['dependencies', 'devDependencies']) {
      for (const [dep, ver] of Object.entries(pkg[section] ?? {})) {
        if (/^(file:|link:|workspace:|\.|\/)/.test(String(ver))) {
          add(`package.json: ${section}.${dep} = "${ver}" is a local path; Actors must build standalone in Docker`);
        }
      }
    }
    if (!isTemplate && pkg.name !== name) add(`package.json: name "${pkg.name}" should equal the folder name "${name}"`);
  }

  // ---- actor.json --------------------------------------------------------------------
  const actorJson = tryJson(dir, '.actor/actor.json', add);
  if (actorJson) {
    if (actorJson.actorSpecification !== 1) add('actor.json: actorSpecification must be 1');
    if (!isTemplate) {
      if (actorJson.name !== name) add(`actor.json: name "${actorJson.name}" should equal the folder name "${name}"`);
      if (!ACTOR_NAME_RE.test(actorJson.name ?? '')) add('actor.json: name must be kebab-case');
      if (/__ACTOR_/.test(JSON.stringify(actorJson))) add('actor.json: unreplaced template placeholder');
    }
    if (!actorJson.title) add('actor.json: missing title');
    if (!actorJson.description) add('actor.json: missing description');
    if (!isTemplate && /One-line description of what this Actor does/.test(actorJson.description ?? '')) {
      add('actor.json: description is still the template placeholder');
    }
    const actorDir = join(dir, '.actor');
    for (const key of ['input', 'dockerfile', 'readme']) {
      const v = actorJson[key];
      if (typeof v === 'string' && !existsSync(resolve(actorDir, v))) add(`actor.json: ${key} points to a missing file (${v})`);
    }
    const ds = actorJson.storages?.dataset;
    if (typeof ds === 'string' && !existsSync(resolve(actorDir, ds))) add(`actor.json: storages.dataset points to a missing file (${ds})`);
  }

  // ---- input schema: tiny deterministic prefill --------------------------------------
  const input = tryJson(dir, '.actor/input_schema.json', add);
  if (input) {
    if (input.type !== 'object') add('input_schema: type must be "object"');
    if (!isTemplate && /Template note/.test(input.description ?? '')) add('input_schema: description is still the template placeholder');
    if (input.schemaVersion !== 1) add('input_schema: schemaVersion must be 1');
    const props = input.properties ?? {};
    for (const [key, prop] of Object.entries(props)) {
      if (!CAMEL_CASE.test(key)) add(`input_schema: property "${key}" should be camelCase`);
      if (!prop.title) add(`input_schema: property "${key}" needs a title`);
      if (!prop.description) add(`input_schema: property "${key}" needs a description`);
      const dflt = prop.prefill !== undefined ? prop.prefill : prop.default;
      if (dflt !== undefined) {
        if (JSON.stringify(dflt).length > MAX_DEFAULT_JSON_CHARS) {
          add(`input_schema: default/prefill of "${key}" is larger than ${MAX_DEFAULT_JSON_CHARS} chars (keep the daily test tiny)`);
        }
        if (Array.isArray(dflt) && dflt.length > MAX_DEFAULT_ARRAY_ITEMS) {
          add(`input_schema: default/prefill of "${key}" has more than ${MAX_DEFAULT_ARRAY_ITEMS} items (keep the daily test tiny)`);
        }
      }
    }
    // The platform test runs the Actor on its default/prefill input: required fields need one of
    // them, and at least one property must carry a `prefill` (the Console form / daily-test input).
    const hasAllRequired = (input.required ?? []).every(
      (k) => props[k] && (props[k].prefill !== undefined || props[k].default !== undefined),
    );
    const hasAnyPrefill = Object.values(props).some((p) => p.prefill !== undefined);
    if (!hasAllRequired) add('input_schema: every required property needs a prefill or default (daily platform test runs on it)');
    if (!hasAnyPrefill) add('input_schema: at least one property needs a `prefill` (the Console form / daily-test input)');
  }

  // ---- dataset schema: camelCase output fields --------------------------------------------
  const datasetSchema = tryJson(dir, '.actor/dataset_schema.json', add);
  if (datasetSchema) {
    for (const key of Object.keys(datasetSchema.fields?.properties ?? {})) {
      if (!CAMEL_CASE.test(key)) add(`dataset_schema: output field "${key}" should be camelCase`);
    }
  }

  // ---- source layout: self-contained, pure lib --------------------------------------------
  const srcDir = join(dir, 'src');
  const dirWithSep = dir.endsWith(sep) ? dir : dir + sep;
  for (const file of listFiles(srcDir, ['.ts'])) {
    const rel = file.slice(dirWithSep.length);
    const text = readFileSync(file, 'utf8');
    const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specs) {
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (!(target + sep).startsWith(dirWithSep)) add(`${rel}: imports "${spec}" from outside the Actor folder (copy shared code instead)`);
      } else if (/^apify(\/|$)/.test(spec) || spec === 'crawlee') {
        const isLib = rel.startsWith(`src${sep}lib${sep}`);
        if (isLib && rel !== join('src', 'lib', 'ppe.ts')) add(`${rel}: src/lib must stay pure - only src/lib/ppe.ts may import "${spec}"`);
      }
    }
  }
  if (!isTemplate) {
    for (const leftover of ['src/lib/example.ts', 'test/example.test.ts']) {
      if (existsSync(join(dir, leftover))) add(`${leftover} is the template's demo logic: replace it with the real implementation and delete it`);
    }
  }
  const tests = listFiles(join(dir, 'test'), ['.test.ts']);
  if (tests.length === 0) add('test/: no *.test.ts files');

  // ---- README structure ---------------------------------------------------------------------
  const readmePath = join(dir, 'README.md');
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, 'utf8');
    if (!/^#\s+\S/m.test(readme)) add('README.md: missing top-level "# Title"');
    for (const [label, re] of README_SECTIONS) {
      if (!re.test(readme)) add(`README.md: missing a "${label}" section heading`);
    }
    if (!isTemplate && /__ACTOR_|Replace every section below/.test(readme)) add('README.md: still contains template placeholder text');
  }

  // ---- pricing.json: events + the >= 5x rule -------------------------------------------------
  const pricing = tryJson(dir, 'pricing.json', add);
  const declaredEvents = new Set();
  if (pricing) {
    const events = pricing.events ?? {};
    if (Object.keys(events).length === 0) add('pricing.json: needs at least one event');
    for (const [ev, def] of Object.entries(events)) {
      declaredEvents.add(ev);
      if (!def.title) add(`pricing.json: event "${ev}" needs a title`);
      if (typeof def.priceUsd !== 'number' || !(def.priceUsd > 0)) add(`pricing.json: event "${ev}" needs priceUsd > 0`);
      if (typeof def.estimatedCostUsd !== 'number' || def.estimatedCostUsd < 0) {
        add(`pricing.json: event "${ev}" needs estimatedCostUsd >= 0 (measured compute + API cost per event)`);
      } else if (typeof def.priceUsd === 'number' && def.priceUsd < 5 * def.estimatedCostUsd) {
        add(`pricing.json: event "${ev}" priceUsd ${def.priceUsd} is below 5x estimatedCostUsd ${def.estimatedCostUsd}`);
      }
      if (ev.startsWith('apify-')) add(`pricing.json: event "${ev}" - names starting with "apify-" are reserved synthetic events`);
      if (!isTemplate && (!def.costBasis || /^Fill in/i.test(def.costBasis))) {
        add(`pricing.json: event "${ev}" needs a real costBasis (how estimatedCostUsd was measured)`);
      }
    }
  }
  const ppePath = join(dir, 'src', 'lib', 'ppe.ts');
  if (existsSync(ppePath) && pricing) {
    const m = /export const PPE_EVENTS\s*=\s*\{([\s\S]*?)\}\s*as const/.exec(readFileSync(ppePath, 'utf8'));
    if (!m) add('src/lib/ppe.ts: could not find "export const PPE_EVENTS = {...} as const"');
    else {
      const used = [...m[1].matchAll(/:\s*['"]([^'"]+)['"]/g)].map((x) => x[1]);
      for (const ev of used) if (!declaredEvents.has(ev)) add(`PPE_EVENTS "${ev}" is not declared in pricing.json`);
      for (const ev of declaredEvents) if (!used.includes(ev)) add(`pricing.json event "${ev}" is not used in PPE_EVENTS`);
    }
  }

  // ---- ppe.ts must be a verbatim copy of the template (only PPE_EVENTS may differ) ---------------
  const templatePpe = join(TEMPLATES_DIR, 'actor-ts', 'src', 'lib', 'ppe.ts');
  if (!isTemplate && existsSync(ppePath) && existsSync(templatePpe)) {
    const strip = (t) => t.replace(/export const PPE_EVENTS\s*=\s*\{[\s\S]*?\}\s*as const;/, 'export const PPE_EVENTS = {};');
    if (strip(readFileSync(ppePath, 'utf8')) !== strip(readFileSync(templatePpe, 'utf8'))) {
      add('src/lib/ppe.ts differs from templates/actor-ts/src/lib/ppe.ts beyond the PPE_EVENTS block (improve the template first, then re-sync)');
    }
  }

  // ---- Dockerfile ----------------------------------------------------------------------------
  const dockerfilePath = join(dir, 'Dockerfile');
  if (existsSync(dockerfilePath)) {
    const firstInstruction = readFileSync(dockerfilePath, 'utf8')
      .split('\n')
      .find((l) => l.trim() !== '' && !l.trim().startsWith('#'));
    if (!/^FROM\s+apify\/actor-node:/i.test(firstInstruction ?? '')) add('Dockerfile: must start with FROM apify/actor-node:<tag>');
  }

  // ---- smoke expectations --------------------------------------------------------------------
  const smoke = tryJson(dir, 'test/smoke.expect.json', add);
  if (smoke) {
    if (!Array.isArray(smoke.requiredFields) || smoke.requiredFields.length === 0) add('smoke.expect.json: requiredFields must be a non-empty array');
    for (const f of smoke.requiredFields ?? []) if (!CAMEL_CASE.test(f)) add(`smoke.expect.json: field "${f}" should be camelCase`);
    if (smoke.charge && !declaredEvents.has(smoke.charge.eventName)) add(`smoke.expect.json: charge.eventName "${smoke.charge.eventName}" is not in pricing.json`);
  }

  return problems;
}
