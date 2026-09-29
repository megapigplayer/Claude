import { describe, expect, it } from 'vitest';
import {
  backoffDelay,
  DEFAULT_HTTP_POLICY,
  fetchText,
  type HttpDeps,
  type HttpPolicy,
  parseRetryAfter,
  SourceFormatError,
  SourceUnavailableError,
} from '../src/lib/http.js';

type Step = { status: number; body?: string; headers?: Record<string, string> } | { fail: Error };

function scripted(steps: Step[]) {
  const calls: Array<{ url: string; headers: Record<string, string>; signal: AbortSignal }> = [];
  const sleeps: number[] = [];
  let i = 0;
  const deps: HttpDeps = {
    fetch: (url, init) => {
      calls.push({ url, headers: init.headers, signal: init.signal });
      const step = steps[Math.min(i++, steps.length - 1)] as Step;
      if ('fail' in step) return Promise.reject(step.fail);
      return Promise.resolve({
        status: step.status,
        headers: { get: (name: string) => step.headers?.[name.toLowerCase()] ?? null },
        text: () => Promise.resolve(step.body ?? ''),
      });
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
  };
  return { deps, calls, sleeps };
}

const policy: HttpPolicy = { ...DEFAULT_HTTP_POLICY, timeoutMs: 5_000, maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 20_000 };

describe('fetchText: success and pass-through statuses', () => {
  it('returns a 200 on the first attempt and sends accept + user-agent headers and a timeout signal', async () => {
    const { deps, calls, sleeps } = scripted([{ status: 200, body: 'hello', headers: { 'content-type': 'text/csv' } }]);
    const res = await fetchText('https://example.test/a?x=1', 'text/csv', policy, deps);
    expect(res).toEqual({ status: 200, body: 'hello', contentType: 'text/csv', attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.accept).toBe('text/csv');
    expect(calls[0]?.headers['user-agent']).toMatch(/bank-of-israel-exchange-rates/);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(sleeps).toEqual([]);
  });

  it.each([404, 403, 400, 401, 204])('does not retry HTTP %i and hands it to the caller', async (status) => {
    const { deps, calls, sleeps } = scripted([{ status, body: 'x' }]);
    const res = await fetchText('https://example.test/a', '*/*', policy, deps);
    expect(res.status).toBe(status);
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });
});

describe('fetchText: retries', () => {
  it('retries a 500 once and then succeeds, waiting the base delay', async () => {
    const { deps, calls, sleeps } = scripted([{ status: 500 }, { status: 200, body: 'ok' }]);
    const res = await fetchText('https://example.test/a', '*/*', policy, deps);
    expect(res.body).toBe('ok');
    expect(res.attempts).toBe(2);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1000]);
  });

  it('backs off exponentially between attempts (1 s, 2 s)', async () => {
    const { deps, sleeps } = scripted([{ status: 503 }, { status: 502 }, { status: 200, body: 'ok' }]);
    await fetchText('https://example.test/a', '*/*', policy, deps);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up after maxAttempts with a clear SourceUnavailableError (HTTP 500 retry, then fail)', async () => {
    const { deps, calls, sleeps } = scripted([{ status: 500 }]);
    const err = await fetchText('https://example.test/data?secret=1', '*/*', policy, deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SourceUnavailableError);
    const e = err as SourceUnavailableError;
    expect(e.attempts).toBe(3);
    expect(e.lastStatus).toBe(500);
    expect(e.code).toBe('SOURCE_UNAVAILABLE');
    expect(e.message).toMatch(/could not be reached after 3 attempt/);
    expect(e.message).toMatch(/HTTP 500/);
    expect(e.message).not.toMatch(/secret=1/); // the query string is dropped from messages
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it('retries network errors and timeouts, and reports the last failure', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const { deps } = scripted([{ fail: new TypeError('fetch failed') }, { fail: timeout }, { status: 200, body: 'late' }]);
    expect((await fetchText('https://example.test/a', '*/*', policy, deps)).body).toBe('late');

    const down = scripted([{ fail: new TypeError('fetch failed', { cause: new Error('ECONNREFUSED') }) }]);
    const err = await fetchText('https://example.test/a', '*/*', policy, down.deps).catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/TypeError: fetch failed \(ECONNREFUSED\)/);
  });

  it('honours Retry-After (seconds) but caps it at maxDelayMs', async () => {
    const a = scripted([{ status: 429, headers: { 'retry-after': '3' } }, { status: 200 }]);
    await fetchText('https://example.test/a', '*/*', policy, a.deps);
    expect(a.sleeps).toEqual([3000]);
    const b = scripted([{ status: 429, headers: { 'retry-after': '600' } }, { status: 200 }]);
    await fetchText('https://example.test/a', '*/*', policy, b.deps);
    expect(b.sleeps).toEqual([20_000]);
  });

  it('makes a single attempt when maxAttempts is 1 (no sleeping)', async () => {
    const { deps, sleeps } = scripted([{ status: 500 }]);
    await expect(fetchText('https://example.test/a', '*/*', { ...policy, maxAttempts: 1 }, deps)).rejects.toBeInstanceOf(SourceUnavailableError);
    expect(sleeps).toEqual([]);
  });
});

describe('helpers', () => {
  it('parseRetryAfter understands seconds, HTTP dates and garbage', () => {
    expect(parseRetryAfter('5', 0)).toBe(5000);
    expect(parseRetryAfter(null, 0)).toBeNull();
    expect(parseRetryAfter('soon', 0)).toBeNull();
    const now = Date.parse('2026-09-29T10:00:00Z');
    expect(parseRetryAfter('Tue, 29 Sep 2026 10:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Tue, 29 Sep 2026 09:00:00 GMT', now)).toBe(0);
  });

  it('backoffDelay doubles, adds bounded jitter and respects the cap', () => {
    expect(backoffDelay(1, policy, () => 0)).toBe(1000);
    expect(backoffDelay(2, policy, () => 0)).toBe(2000);
    expect(backoffDelay(3, policy, () => 0)).toBe(4000);
    expect(backoffDelay(1, policy, () => 1)).toBe(1250);
    expect(backoffDelay(10, policy, () => 1)).toBe(20_000);
  });

  it('error classes carry a stable machine code', () => {
    expect(new SourceFormatError('x', 'snippet').code).toBe('SOURCE_FORMAT_ERROR');
    expect(new SourceFormatError('x').snippet).toBe('');
  });
});
