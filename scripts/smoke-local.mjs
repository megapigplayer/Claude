#!/usr/bin/env node
/**
 * Run an Actor locally (Apify local mode, offline, no token) on its prefill input and
 * assert that the default dataset is non-empty and has the expected fields.
 *
 *   node scripts/smoke-local.mjs <name> [--no-build] [--no-ppe] [--measure] [--input file.json]
 *   node scripts/smoke-local.mjs --all
 *
 * See scripts/lib/smoke.mjs for exactly what is run and asserted. Expectations live in
 * <actor>/test/smoke.expect.json. `--measure` also prints wall time / peak RSS and an
 * ASSUMPTION-based cost estimate per event (constants overridable via SMOKE_CU_USD).
 */
import { isMain, listTargets, resolveTarget } from './lib/common.mjs';
import { runSmoke } from './lib/smoke.mjs';

function parseArgs(argv) {
  const opts = { names: [], all: false, build: true, ppe: true, measure: false, inputFile: undefined, memoryMb: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') opts.all = true;
    else if (a === '--no-build') opts.build = false;
    else if (a === '--no-ppe') opts.ppe = false;
    else if (a === '--measure') opts.measure = true;
    else if (a === '--input') opts.inputFile = argv[++i];
    else if (a === '--memory-mb') opts.memoryMb = Number(argv[++i]);
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--')) throw new Error(`Unknown flag ${a}`);
    else opts.names.push(a);
  }
  return opts;
}

export function printSmokeResult(name, res) {
  console.log(`\n== smoke: ${name} ==`);
  for (const c of res.checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.label}`);
    if (!c.ok && c.detail) console.log(c.detail.split('\n').map((l) => `        ${l}`).join('\n'));
  }
  if (res.measure) {
    const m = res.measure;
    console.log(
      `  MEASURE  wall ${m.wallMs} ms, peak RSS ${m.peakRssMb} MB (billed as ${m.allocatedMb} MB), ` +
        `est. run cost $${m.runCostUsd.toExponential(2)} @ $${m.cuUsd}/CU [assumption], ${m.events} event(s) => $${m.perEventUsd.toExponential(2)}/event` +
        (m.priceToCostRatio ? `, price $${m.priceUsd} = ${m.priceToCostRatio.toFixed(0)}x cost (rule: >= 5x)` : ''),
    );
  }
  console.log(`  ${res.ok ? 'SMOKE PASSED' : 'SMOKE FAILED'} (${(res.ms / 1000).toFixed(1)}s)`);
}

if (isMain(import.meta.url)) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help || (!opts.all && opts.names.length === 0)) {
    console.error('Usage: node scripts/smoke-local.mjs <name> [--no-build] [--no-ppe] [--measure] [--input file.json] [--memory-mb N]');
    console.error('       node scripts/smoke-local.mjs --all');
    process.exit(opts.help ? 0 : 2);
  }
  const targets = opts.all ? listTargets() : opts.names.map((n) => resolveTarget(n));
  let failed = 0;
  for (const t of targets) {
    const res = await runSmoke(t, opts);
    printSmokeResult(t.name, res);
    if (!res.ok) failed += 1;
  }
  process.exit(failed === 0 ? 0 : 1);
}
