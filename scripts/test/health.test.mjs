import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateRuns, runHealthCheck } from '../check-health.mjs';

const run = (status, id = 'r') => ({ status, id });

test('evaluateRuns: healthy, unhealthy and empty histories', () => {
  assert.equal(evaluateRuns([run('SUCCEEDED'), run('SUCCEEDED'), run('FAILED')]).level, 'ok');
  assert.equal(evaluateRuns([run('FAILED'), run('SUCCEEDED'), run('SUCCEEDED')]).level, 'fail'); // last run failed
  assert.equal(evaluateRuns([run('SUCCEEDED'), run('FAILED'), run('TIMED-OUT')]).level, 'fail'); // 2 of last 3
  assert.equal(evaluateRuns([run('RUNNING'), run('SUCCEEDED')]).level, 'ok'); // in-progress ignored
  assert.equal(evaluateRuns([run('ABORTED'), run('SUCCEEDED')]).level, 'ok'); // user abort is not a health signal
  assert.equal(evaluateRuns([]).level, 'warn');
  assert.equal(evaluateRuns(undefined).level, 'warn');
});

test('runHealthCheck without APIFY_TOKEN is inert: exit 0 with a notice and no network call', async () => {
  let calls = 0;
  const out = await runHealthCheck({ env: {}, fetchImpl: () => { calls++; }, actors: [{ folder: 'a', name: 'a' }] });
  assert.equal(out.exitCode, 0);
  assert.match(out.lines[0], /::notice/);
  assert.equal(calls, 0);
});

function fakeApi(routes) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, auth: init?.headers?.Authorization });
    const path = url.replace('https://api.apify.com/v2', '');
    const hit = Object.entries(routes).find(([k]) => path.startsWith(k));
    const [status, body] = hit ? hit[1] : [404, { error: {} }];
    return { status, json: async () => body };
  };
  return { fetchImpl, seen };
}

test('runHealthCheck fails loudly when an Actor is unhealthy and passes otherwise', async () => {
  const { fetchImpl, seen } = fakeApi({
    '/users/me': [200, { data: { username: 'me' } }],
    '/acts/me~good/runs': [200, { data: { items: [run('SUCCEEDED'), run('SUCCEEDED')] } }],
    '/acts/me~bad/runs': [200, { data: { items: [run('FAILED'), run('FAILED'), run('SUCCEEDED')] } }],
  });
  const actors = [{ folder: 'good', name: 'good' }, { folder: 'bad', name: 'bad' }, { folder: 'new', name: 'new' }];
  const out = await runHealthCheck({ env: { APIFY_TOKEN: 't0ken' }, fetchImpl, actors });
  assert.equal(out.exitCode, 1);
  assert.ok(out.lines.some((l) => l.startsWith('::error title=Actor unhealthy: bad')));
  assert.ok(out.lines.some((l) => l.startsWith('::warning title=Actor health: new'))); // 404 = not deployed yet
  assert.ok(seen.every((s) => s.auth === 'Bearer t0ken'));
  const strict = await runHealthCheck({ env: { APIFY_TOKEN: 't' }, fetchImpl, actors: [{ folder: 'new', name: 'new' }], strict: true });
  assert.equal(strict.exitCode, 1);
  const healthy = await runHealthCheck({ env: { APIFY_TOKEN: 't' }, fetchImpl, actors: [actors[0]] });
  assert.equal(healthy.exitCode, 0);
});

test('runHealthCheck fails (never silently green) when the API rejects the token', async () => {
  const { fetchImpl } = fakeApi({ '/users/me': [401, { error: { type: 'token-not-valid' } }] });
  const out = await runHealthCheck({ env: { APIFY_TOKEN: 'bad' }, fetchImpl, actors: [{ folder: 'a', name: 'a' }] });
  assert.equal(out.exitCode, 1);
  assert.match(out.lines[0], /::error/);
});
