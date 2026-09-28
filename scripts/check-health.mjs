#!/usr/bin/env node
/**
 * Nightly health check: read the recent run status of every Actor in this repo through the
 * Apify API and FAIL LOUDLY when one is unhealthy.
 *
 *   APIFY_TOKEN=... node scripts/check-health.mjs [--strict]
 *
 * - No APIFY_TOKEN -> prints a notice and exits 0 (the workflow is inert without the secret).
 * - Otherwise, for each folder in actors/: id = "<username>~<actor.json name>", then
 *   GET /v2/acts/<id>/runs?desc=1&limit=5, and apply the platform's own maintenance rule:
 *   2 failed runs among the last 3 finished runs => "would be marked under maintenance";
 *   a failed most-recent run is also reported as failure.
 * - An Actor that does not exist on the platform yet is a warning (error with --strict).
 * - API/auth errors are failures too: a monitor that cannot see anything must never be green.
 *
 * UNVERIFIED: the authoring sandbox has no network access to api.apify.com (proxy answers
 * 403), so the endpoints and response fields below follow the public Apify API v2 docs from
 * memory and have NOT been exercised against the live API. The evaluation logic and the
 * request flow are unit-tested against fixtures in scripts/test/health.test.mjs.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ACTORS_DIR, isMain, readJson } from './lib/common.mjs';

const FAILED_STATUSES = new Set(['FAILED', 'TIMED-OUT']);
const FINISHED_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT']); // ABORTED = user action, not health

/** runs: newest first, as returned with desc=1. */
export function evaluateRuns(runs) {
  const finished = (runs ?? []).filter((r) => FINISHED_STATUSES.has(r.status));
  if (finished.length === 0) return { level: 'warn', reason: 'no finished runs yet' };
  const last3 = finished.slice(0, 3);
  const failedOfLast3 = last3.filter((r) => FAILED_STATUSES.has(r.status)).length;
  if (failedOfLast3 >= 2) {
    return { level: 'fail', reason: `${failedOfLast3} of the last ${last3.length} finished runs failed (Apify marks Actors "under maintenance" at 2 of 3)` };
  }
  if (FAILED_STATUSES.has(finished[0].status)) {
    return { level: 'fail', reason: `most recent run ${finished[0].id ?? ''} ended ${finished[0].status}` };
  }
  return { level: 'ok', reason: `last run ${finished[0].status}` };
}

export function listActorNames(actorsDir = ACTORS_DIR) {
  if (!existsSync(actorsDir)) return [];
  return readdirSync(actorsDir)
    .filter((d) => existsSync(join(actorsDir, d, '.actor', 'actor.json')))
    .sort()
    .map((folder) => ({ folder, name: readJson(join(actorsDir, folder, '.actor', 'actor.json')).name ?? folder }));
}

async function apiGet(fetchImpl, base, path, token) {
  const res = await fetchImpl(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body };
}

/** Pure-ish entry point (injectable env/fetch/actors) so it can be unit-tested. */
export async function runHealthCheck({ env = process.env, fetchImpl = globalThis.fetch, actors = listActorNames(), strict = false } = {}) {
  const lines = [];
  const say = (l) => lines.push(l);
  const token = env.APIFY_TOKEN;
  if (!token) {
    say('::notice title=Health check skipped::APIFY_TOKEN is not set, so run statuses cannot be read. Add the repository secret APIFY_TOKEN to enable this check.');
    return { exitCode: 0, lines, results: [] };
  }
  const base = (env.APIFY_API_BASE_URL ?? 'https://api.apify.com/v2').replace(/\/$/, '');

  let username = env.APIFY_USERNAME;
  if (!username) {
    const me = await apiGet(fetchImpl, base, '/users/me', token).catch((e) => ({ status: 0, body: { error: { message: e.message } } }));
    username = me.body?.data?.username;
    if (me.status !== 200 || !username) {
      say(`::error title=Health check cannot authenticate::GET /users/me returned HTTP ${me.status}. Check the APIFY_TOKEN secret (or set APIFY_USERNAME).`);
      return { exitCode: 1, lines, results: [] };
    }
  }

  const results = [];
  for (const { folder, name } of actors) {
    const id = `${username}~${name}`;
    let r;
    try {
      r = await apiGet(fetchImpl, base, `/acts/${encodeURIComponent(id)}/runs?desc=1&limit=5`, token);
    } catch (err) {
      results.push({ folder, name, level: 'fail', reason: `request failed: ${err.message}` });
      continue;
    }
    if (r.status === 404) {
      results.push({ folder, name, level: strict ? 'fail' : 'warn', reason: 'not found on the platform (not deployed yet?)' });
    } else if (r.status !== 200 || !Array.isArray(r.body?.data?.items)) {
      results.push({ folder, name, level: 'fail', reason: `unexpected API response (HTTP ${r.status})` });
    } else {
      results.push({ folder, name, ...evaluateRuns(r.body.data.items) });
    }
  }

  for (const r of results) {
    const title = `${r.name}`;
    if (r.level === 'fail') say(`::error title=Actor unhealthy: ${title}::${r.reason}`);
    else if (r.level === 'warn') say(`::warning title=Actor health: ${title}::${r.reason}`);
    else say(`OK    ${r.name}: ${r.reason}`);
  }
  const failed = results.filter((r) => r.level === 'fail').length;
  say(`${results.length} Actor(s) checked, ${failed} unhealthy, ${results.filter((r) => r.level === 'warn').length} warning(s).`);
  return { exitCode: failed > 0 ? 1 : 0, lines, results };
}

if (isMain(import.meta.url)) {
  const { exitCode, lines } = await runHealthCheck({ strict: process.argv.includes('--strict') });
  for (const l of lines) console.log(l);
  process.exit(exitCode);
}
