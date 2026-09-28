/**
 * Local smoke run of one Actor in Apify "local mode", offline, no token.
 *
 * How it mirrors the platform (all verified against apify@3.7.2, see CONVENTIONS.md):
 * - Storage: the SDK's local storage dir is CRAWLEE_STORAGE_DIR (memory-storage.js:86);
 *   APIFY_LOCAL_STORAGE_DIR is only mentioned in doc comments and is ignored by v3 - like
 *   `apify run` we set both. INPUT lives in <dir>/key_value_stores/default/INPUT.json and
 *   dataset rows are written to <dir>/datasets/default/*.json.
 * - Input: the daily platform test runs the Actor on its default/prefill input, so we build
 *   the input from .actor/input_schema.json (prefill wins over default).
 * - We strip every APIFY_*, ACTOR_* and CRAWLEE_* variable from the environment so the run
 *   provably needs no token and is not "at home" (APIFY_IS_AT_HOME unset => PPE inactive).
 *
 * Passes:
 *   A  plain run           : exit 0, dataset non-empty, required fields present, row matches
 *   B  simulated PPE       : ACTOR_TEST_PAY_PER_EVENT=true + ACTOR_USE_CHARGING_LOG_DATASET=true
 *                            -> local dataset "charging_log" must show the expected events
 *   C  budget cap          : + ACTOR_MAX_TOTAL_CHARGE_USD=<cap> -> run stops early, exit 0
 * Expectations live in <actor>/test/smoke.expect.json.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmtMs, npm, readJson, run, tail } from './common.mjs';

const PRELOAD = join(dirname(fileURLToPath(import.meta.url)), 'measure-preload.cjs');
export const SMOKE_TIMEOUT_MS = 110_000; // the platform's daily test budget is 2 minutes

export function inputFromSchema(dir) {
  const schema = readJson(join(dir, '.actor', 'input_schema.json'));
  const input = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    if (prop.prefill !== undefined) input[key] = prop.prefill;
    else if (prop.default !== undefined) input[key] = prop.default;
  }
  return input;
}

export function readLocalDataset(storageDir, name = 'default') {
  const d = join(storageDir, 'datasets', name);
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => f.endsWith('.json') && !f.startsWith('__metadata__'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));
}

/** Every key of `expected` must be deep-equal in `actual` (extra keys in actual are fine). */
export function isSubset(expected, actual) {
  if (expected === null || typeof expected !== 'object') return Object.is(expected, actual);
  if (actual === null || typeof actual !== 'object') return false;
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && expected.length === actual.length && expected.every((e, i) => isSubset(e, actual[i]));
  }
  return Object.entries(expected).every(([k, v]) => isSubset(v, actual[k]));
}

function cleanEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(APIFY_|ACTOR_|CRAWLEE_)/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

async function runPass({ dir, storageDir, input, extraEnv = {}, measureFile }) {
  rmSync(storageDir, { recursive: true, force: true });
  const kvs = join(storageDir, 'key_value_stores', 'default');
  mkdirSync(kvs, { recursive: true });
  writeFileSync(join(kvs, 'INPUT.json'), JSON.stringify(input, null, 2));
  const env = cleanEnv({
    CRAWLEE_STORAGE_DIR: storageDir,
    APIFY_LOCAL_STORAGE_DIR: storageDir,
    CRAWLEE_PURGE_ON_START: '0',
    ...(measureFile ? { SMOKE_MEASURE_FILE: measureFile } : {}),
    ...extraEnv,
  });
  const args = [...(measureFile ? ['--require', PRELOAD] : []), 'dist/main.js'];
  const res = await run(process.execPath, args, { cwd: dir, env, timeoutMs: SMOKE_TIMEOUT_MS });
  return { ...res, items: readLocalDataset(storageDir), chargingLog: readLocalDataset(storageDir, 'charging_log') };
}

/** Rough compute-cost estimate; every constant here is an ASSUMPTION (see CONVENTIONS.md). */
export function estimateCost({ wallMs, maxRssKb, allocatedMb, cuUsd, events, priceUsd }) {
  const computeUnits = (allocatedMb / 1024) * (wallMs / 3_600_000);
  const runCostUsd = computeUnits * cuUsd;
  const perEventUsd = events > 0 ? runCostUsd / events : runCostUsd;
  return {
    wallMs,
    peakRssMb: Math.round(maxRssKb / 1024),
    allocatedMb,
    cuUsd,
    runCostUsd,
    events,
    perEventUsd,
    priceUsd: priceUsd ?? null,
    priceToCostRatio: priceUsd && perEventUsd > 0 ? priceUsd / perEventUsd : null,
  };
}

export async function runSmoke(target, opts = {}) {
  const { dir } = target;
  const checks = [];
  const started = Date.now();
  const check = (label, ok, detail = '') => {
    checks.push({ label, ok: Boolean(ok), detail });
    return Boolean(ok);
  };
  let measure = null;
  const result = () => ({ ok: checks.every((c) => c.ok), checks, ms: Date.now() - started, measure });

  const expectPath = join(dir, 'test', 'smoke.expect.json');
  const expected = existsSync(expectPath) ? readJson(expectPath) : {};
  const pricing = existsSync(join(dir, 'pricing.json')) ? readJson(join(dir, 'pricing.json')) : null;
  const storageRoot = join(dir, 'storage', 'smoke');

  if (opts.build !== false) {
    const b = await npm(['run', 'build'], { cwd: dir });
    if (!check('build (tsc)', b.code === 0, b.code === 0 ? '' : tail(b.stdout + b.stderr))) return result();
  }
  if (!check('dist/main.js exists', existsSync(join(dir, 'dist', 'main.js')))) return result();

  let input;
  try {
    input = opts.inputFile ? readJson(opts.inputFile) : inputFromSchema(dir);
  } catch (err) {
    check('input built from .actor/input_schema.json', false, err.message);
    return result();
  }

  // ---- Pass A: plain local run ------------------------------------------------------------------
  const measureFile = opts.measure ? join(storageRoot, 'measure.json') : undefined;
  if (measureFile) mkdirSync(storageRoot, { recursive: true });
  const a = await runPass({ dir, storageDir: join(storageRoot, 'plain'), input, measureFile });
  const tailDetail = a.code === 0 ? '' : tail(a.stdout + a.stderr);
  check(`plain local run exits 0 within ${fmtMs(SMOKE_TIMEOUT_MS)} (took ${fmtMs(a.ms)})`, a.code === 0 && !a.timedOut, tailDetail);
  const itemsA = a.items;
  check('default dataset is non-empty', itemsA.length >= (expected.minItems ?? 1), `${itemsA.length} item(s)`);
  if (expected.expectedItems !== undefined) {
    check(`default dataset has exactly ${expected.expectedItems} item(s)`, itemsA.length === expected.expectedItems, `${itemsA.length} item(s)`);
  }
  const required = expected.requiredFields ?? [];
  const missing = [];
  itemsA.forEach((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) missing.push(`#${i}: not an object`);
    else for (const f of required) if (!(f in item) || item[f] === undefined) missing.push(`#${i}: missing "${f}"`);
  });
  check(`every item has the expected fields [${required.join(', ')}]`, required.length > 0 && missing.length === 0, missing.slice(0, 5).join('; '));
  for (const [i, rowExpect] of (expected.rows ?? []).entries()) {
    check(`row #${i} matches expectation`, isSubset(rowExpect, itemsA[i]), `expected ⊆ ${JSON.stringify(rowExpect)}; got ${JSON.stringify(itemsA[i])}`);
  }
  check('plain run wrote no charging log (PPE inactive locally)', a.chargingLog.length === 0);

  if (measureFile && existsSync(measureFile)) {
    const m = readJson(measureFile);
    const cuUsd = Number(process.env.SMOKE_CU_USD ?? 0.4); // ASSUMPTION, override with SMOKE_CU_USD
    const actorJson = existsSync(join(dir, '.actor', 'actor.json')) ? readJson(join(dir, '.actor', 'actor.json')) : {};
    const allocatedMb = Number(opts.memoryMb ?? actorJson.defaultMemoryMbytes ?? 1024);
    const eventName = expected.charge?.eventName;
    const priceUsd = eventName ? pricing?.events?.[eventName]?.priceUsd : undefined;
    const perItem = expected.charge?.perItem ?? 1;
    const events = itemsA.length * perItem;
    measure = estimateCost({ ...m, allocatedMb, cuUsd, events, priceUsd });
  }

  // ---- Pass B: simulated pay-per-event -----------------------------------------------------------
  if (opts.ppe !== false && pricing && expected.charge) {
    const ppeEnv = { ACTOR_TEST_PAY_PER_EVENT: 'true', ACTOR_USE_CHARGING_LOG_DATASET: 'true' };
    const b = await runPass({ dir, storageDir: join(storageRoot, 'ppe'), input, extraEnv: ppeEnv });
    check('simulated PPE run exits 0', b.code === 0 && !b.timedOut, b.code === 0 ? '' : tail(b.stdout + b.stderr));
    check('simulated PPE run produced the same number of items', b.items.length === itemsA.length, `${b.items.length} vs ${itemsA.length}`);
    const byEvent = {};
    for (const entry of b.chargingLog) {
      if (String(entry.eventName).startsWith('apify-')) continue; // synthetic platform events are not ours to assert on
      byEvent[entry.eventName] = (byEvent[entry.eventName] ?? 0) + entry.chargedCount;
    }
    const declared = new Set(Object.keys(pricing.events ?? {}));
    const undeclared = Object.keys(byEvent).filter((e) => !declared.has(e));
    check('every charged event is declared in pricing.json', undeclared.length === 0, undeclared.join(', '));
    const want = expected.charge.perItem * b.items.length;
    check(
      `charged ${want} x "${expected.charge.eventName}" (${expected.charge.perItem} per item)`,
      byEvent[expected.charge.eventName] === want,
      `charging_log: ${JSON.stringify(byEvent)}`,
    );

    // ---- Pass C: maxTotalChargeUsd cap ---------------------------------------------------------
    if (expected.budgetCap) {
      const c = await runPass({
        dir,
        storageDir: join(storageRoot, 'cap'),
        input,
        extraEnv: { ...ppeEnv, ACTOR_MAX_TOTAL_CHARGE_USD: String(expected.budgetCap.maxTotalChargeUsd) },
      });
      check(`run with ACTOR_MAX_TOTAL_CHARGE_USD=${expected.budgetCap.maxTotalChargeUsd} exits 0`, c.code === 0 && !c.timedOut, c.code === 0 ? '' : tail(c.stdout + c.stderr));
      check(
        `budget cap stops the run early (${expected.budgetCap.expectedItems} of ${itemsA.length} items)`,
        c.items.length === expected.budgetCap.expectedItems && c.items.length < itemsA.length,
        `${c.items.length} item(s) pushed`,
      );
    }
  }

  return result();
}
