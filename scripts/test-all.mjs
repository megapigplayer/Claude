#!/usr/bin/env node
/**
 * Install + check + build + test every Actor (and the template), then print a summary table.
 *
 *   node scripts/test-all.mjs                   # everything, fast path (root npm workspace)
 *   node scripts/test-all.mjs --smoke           # + local smoke run of each Actor (scripts/lib/smoke.mjs)
 *   node scripts/test-all.mjs --standalone      # + copy each Actor OUT of the repo and npm install/build/test it
 *                                               #   alone (proves it builds without the workspace, like Docker)
 *   node scripts/test-all.mjs --only iban-validator,actor-ts
 *   node scripts/test-all.mjs --skip-install --jobs 4
 *
 * Columns: Conventions (static checklist), Schema (official Apify schemas, offline), Build (tsc),
 * Types (tsc over src + test), Tests (vitest), Smoke (optional), Standalone (optional).
 * Exit code 1 if anything fails.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkActorConventions } from './lib/check-actor.mjs';
import { fmtMs, isMain, listTargets, npm, REPO_ROOT, renderTable, run, tail } from './lib/common.mjs';
import { runSmoke } from './lib/smoke.mjs';
import { validateSchemas } from './lib/validate-schemas.mjs';

const ANSI = /\u001b\[[0-9;]*m/g;

function parseArgs(argv) {
  const opts = { only: [], skipInstall: false, smoke: false, standalone: false, jobs: Math.max(1, Math.min(4, availableParallelism() - 1)) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') opts.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else if (a === '--skip-install') opts.skipInstall = true;
    else if (a === '--smoke') opts.smoke = true;
    else if (a === '--standalone') opts.standalone = true;
    else if (a === '--jobs') opts.jobs = Math.max(1, Number(argv[++i]) || 1);
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  return opts;
}

function parseVitest(output) {
  const text = output.replace(ANSI, '');
  const m = /Tests\s+(?:(\d+) failed \| )?(\d+) passed(?: \| (\d+) skipped)?/.exec(text);
  if (!m) return null;
  return { failed: Number(m[1] ?? 0), passed: Number(m[2]), skipped: Number(m[3] ?? 0) };
}

async function testTarget(target, opts) {
  const row = { target, cells: {}, logs: [] };
  const fail = (col, log) => {
    row.cells[col] = 'FAIL';
    if (log) row.logs.push(`[${target.name}] ${col}:\n${log}`);
  };
  const started = Date.now();

  // 1. static conventions (offline, instant)
  const problems = checkActorConventions(target);
  if (problems.length === 0) row.cells.conventions = 'ok';
  else fail('conventions', problems.map((p) => `  - ${p}`).join('\n'));

  // 2. official schemas
  const schema = await validateSchemas(target);
  if (schema.problems.length > 0) fail('schema', schema.problems.join('\n'));
  else row.cells.schema = schema.skipped > 0 ? 'ok*' : 'ok';

  // 3. templates are not workspace members: install them standalone first
  if (target.kind === 'template' && !opts.skipInstall) {
    const i = await npm(['install', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'], { cwd: target.dir });
    if (i.code !== 0) {
      fail('build', `npm install failed:\n${tail(i.stdout + i.stderr)}`);
      row.cells.tests = 'skip';
      row.ms = Date.now() - started;
      return row;
    }
  }

  // 4. build (tsc) + unit tests (vitest)
  const build = await npm(['run', 'build'], { cwd: target.dir });
  if (build.code === 0) row.cells.build = 'ok';
  else fail('build', tail(build.stdout + build.stderr));

  // tsc over src AND test (vitest itself does not type-check)
  const types = await npm(['run', 'typecheck'], { cwd: target.dir });
  if (types.code === 0) row.cells.types = 'ok';
  else fail('types', tail(types.stdout + types.stderr));

  const test = await npm(['test'], { cwd: target.dir, env: { ...process.env, CI: '1', FORCE_COLOR: '0' } });
  const counts = parseVitest(test.stdout + test.stderr);
  if (test.code === 0) row.cells.tests = counts ? `ok (${counts.passed})` : 'ok';
  else fail('tests', tail(test.stdout + test.stderr, 40));

  // 5. optional local smoke run (Apify local mode, offline)
  if (opts.smoke) {
    if (build.code !== 0) row.cells.smoke = 'skip';
    else {
      const smoke = await runSmoke(target, { build: false });
      if (smoke.ok) row.cells.smoke = `ok (${fmtMs(smoke.ms)})`;
      else fail('smoke', smoke.checks.filter((c) => !c.ok).map((c) => `  - ${c.label}\n${c.detail}`).join('\n'));
    }
  }

  // 6. optional standalone install/build/test outside the workspace (Docker-like)
  if (opts.standalone) {
    const tmp = mkdtempSync(join(tmpdir(), `standalone-${target.name}-`));
    try {
      cpSync(target.dir, tmp, {
        recursive: true,
        filter: (src) => !/[\\/](node_modules|dist|storage)([\\/]|$)/.test(src),
      });
      const steps = [
        ['install', ['install', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error']],
        ['build', ['run', 'build']],
        ['typecheck', ['run', 'typecheck']],
        ['test', ['test']],
      ];
      let ok = true;
      for (const [label, args] of steps) {
        const r = await npm(args, { cwd: tmp, env: { ...process.env, CI: '1' } });
        if (r.code !== 0) {
          fail('standalone', `${label} failed in ${tmp}:\n${tail(r.stdout + r.stderr)}`);
          ok = false;
          break;
        }
      }
      if (ok && opts.smoke) {
        // Run the standalone build with its OWN node_modules, like the Docker image would.
        const smoke = await runSmoke({ ...target, dir: tmp }, { build: false });
        if (!smoke.ok) {
          fail('standalone', `smoke run of the standalone copy failed:\n${smoke.checks.filter((c) => !c.ok).map((c) => `  - ${c.label}\n${c.detail}`).join('\n')}`);
          ok = false;
        }
      }
      if (ok) row.cells.standalone = 'ok';
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }

  row.ms = Date.now() - started;
  return row;
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/test-all.mjs [--only a,b] [--smoke] [--standalone] [--skip-install] [--jobs N]');
    return 0;
  }
  const t0 = Date.now();
  const targets = listTargets({ only: opts.only });
  if (targets.length === 0) {
    console.error('No actors found under actors/ or templates/.');
    return 1;
  }

  const summaryExtra = [];
  let installMs = 0;
  if (!opts.skipInstall) {
    const lock = existsSync(join(REPO_ROOT, 'package-lock.json'));
    const args = process.env.CI && lock ? ['ci'] : ['install'];
    console.log(`Installing workspace dependencies (npm ${args[0]}) ...`);
    const i = await npm([...args, '--no-audit', '--no-fund', '--loglevel=error'], { cwd: REPO_ROOT });
    installMs = i.ms;
    if (i.code !== 0) {
      console.error(`npm ${args[0]} failed:\n${tail(i.stdout + i.stderr, 40)}`);
      return 1;
    }
    console.log(`  installed in ${fmtMs(i.ms)}`);
  }

  // Repo-level script tests (node:test) - only when running everything.
  let scriptsRow = null;
  if (opts.only.length === 0) {
    const testDir = join(REPO_ROOT, 'scripts', 'test');
    if (existsSync(testDir)) {
      const files = readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')).map((f) => join(testDir, f));
      if (files.length > 0) {
        const r = await run(process.execPath, ['--test', ...files], { cwd: REPO_ROOT });
        const text = r.stdout + r.stderr;
        const pass = /# pass (\d+)/.exec(text)?.[1];
        scriptsRow = { ok: r.code === 0, detail: r.code === 0 ? `ok (${pass ?? '?'})` : 'FAIL', log: tail(text, 40) };
      }
    }
  }

  console.log(`Testing ${targets.length} target(s) with ${opts.jobs} parallel job(s) ...`);
  const rows = await pool(targets, opts.jobs, (t) => testTarget(t, opts));

  const columns = ['conventions', 'schema', 'build', 'types', 'tests', ...(opts.smoke ? ['smoke'] : []), ...(opts.standalone ? ['standalone'] : [])];
  const header = ['Target', 'Kind', ...columns.map((c) => c[0].toUpperCase() + c.slice(1)), 'Time'];
  const tableRows = rows.map((r) => [r.target.name, r.target.kind, ...columns.map((c) => r.cells[c] ?? '-'), fmtMs(r.ms)]);
  if (scriptsRow) tableRows.push(['scripts/test', 'repo', ...columns.map((c) => (c === 'tests' ? scriptsRow.detail : '-')), '']);

  console.log(`\n${renderTable(header, tableRows)}\n`);
  if (anySchemaSkipped(rows)) console.log('* schema: some checks skipped (apify-cli / @apify/json_schemas not installed)\n');

  const failedRows = rows.filter((r) => Object.values(r.cells).some((c) => c === 'FAIL'));
  const anyFail = failedRows.length > 0 || (scriptsRow && !scriptsRow.ok);
  for (const r of failedRows) for (const log of r.logs) console.log(`${log}\n`);
  if (scriptsRow && !scriptsRow.ok) console.log(`[scripts/test]\n${scriptsRow.log}\n`);
  summaryExtra.push(`${rows.length - failedRows.length}/${rows.length} targets passed`);
  console.log(`${anyFail ? 'FAILED' : 'ALL PASSED'}: ${summaryExtra.join(', ')} in ${fmtMs(Date.now() - t0)} (install ${fmtMs(installMs)})`);
  return anyFail ? 1 : 0;
}

function anySchemaSkipped(rows) {
  return rows.some((r) => r.cells.schema === 'ok*');
}

if (isMain(import.meta.url)) {
  process.exit(await main().catch((err) => {
    console.error(err.stack ?? err.message);
    return 1;
  }));
}
