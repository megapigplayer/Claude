/**
 * Small HTTP client with a per-attempt timeout and bounded retries (pure: the `fetch`, `sleep` and
 * `random` functions are injected, so tests never touch the network or the clock).
 *
 * Policy:
 * - network errors, timeouts and HTTP 408/425/429/500/502/503/504 are retried with exponential
 *   backoff plus jitter (a `Retry-After` header is honoured, capped);
 * - every other HTTP status (200, 404, 403, 400 ...) is returned as-is: the adapter decides what
 *   it means, this layer never guesses;
 * - when all attempts fail the caller gets a `SourceUnavailableError` that says what was tried.
 */

export class SourceUnavailableError extends Error {
  readonly code = 'SOURCE_UNAVAILABLE' as const;
  constructor(
    message: string,
    readonly attempts: number,
    readonly lastStatus: number | null,
  ) {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

/** The source answered, but not with anything this Actor understands (format change, HTML block page, ...). */
export class SourceFormatError extends Error {
  readonly code = 'SOURCE_FORMAT_ERROR' as const;
  constructor(
    message: string,
    /** First characters of the offending response, to make the log actionable. */
    readonly snippet: string = '',
  ) {
    super(message);
    this.name = 'SourceFormatError';
  }
}

export interface HttpPolicy {
  timeoutMs: number;
  /** Total attempts, including the first one. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  userAgent: string;
}

export const DEFAULT_HTTP_POLICY: HttpPolicy = {
  timeoutMs: 15_000,
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 20_000,
  userAgent: 'apify-actor-bank-of-israel-exchange-rates/0.1 (automated client for public central-bank data)',
};

export interface HttpDeps {
  fetch: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<HttpResponseLike>;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

/** The subset of the Fetch `Response` this client reads (lets tests use tiny fakes). */
export interface HttpResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface HttpResult {
  status: number;
  body: string;
  contentType: string | null;
  attempts: number;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** `Retry-After` is either delta-seconds or an HTTP date; returns milliseconds or null. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

export function backoffDelay(attempt: number, policy: HttpPolicy, random: () => number): number {
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const jitter = random() * policy.baseDelayMs * 0.25;
  return Math.min(policy.maxDelayMs, Math.round(exponential + jitter));
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = err.cause instanceof Error ? ` (${err.cause.message})` : '';
    return `${err.name}: ${err.message}${cause}`;
  }
  return String(err);
}

export async function fetchText(
  url: string,
  accept: string,
  policy: HttpPolicy,
  deps: HttpDeps,
  nowMs: () => number = Date.now,
): Promise<HttpResult> {
  let lastFailure = 'no attempt was made';
  let lastStatus: number | null = null;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    let retryAfterMs: number | null = null;
    try {
      const response = await deps.fetch(url, {
        headers: { accept, 'user-agent': policy.userAgent },
        signal: AbortSignal.timeout(policy.timeoutMs),
      });
      if (!RETRYABLE_STATUS.has(response.status)) {
        const body = await response.text();
        return { status: response.status, body, contentType: response.headers.get('content-type'), attempts: attempt };
      }
      lastStatus = response.status;
      lastFailure = `HTTP ${response.status}`;
      retryAfterMs = parseRetryAfter(response.headers.get('retry-after'), nowMs());
    } catch (err) {
      lastFailure = describeError(err);
    }
    if (attempt < policy.maxAttempts) {
      const wait = Math.min(policy.maxDelayMs, retryAfterMs ?? backoffDelay(attempt, policy, deps.random));
      await deps.sleep(wait);
    }
  }
  throw new SourceUnavailableError(
    `The Bank of Israel source could not be reached after ${policy.maxAttempts} attempt(s) (${lastFailure}) for ${redact(url)}.`,
    policy.maxAttempts,
    lastStatus,
  );
}

/** Keep the log readable: drop the query string. */
function redact(url: string): string {
  const i = url.indexOf('?');
  return i === -1 ? url : `${url.slice(0, i)}?...`;
}
