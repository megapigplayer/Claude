/**
 * A `fetch` replacement that answers the adapter's requests from the recorded-style fixture files in
 * test/fixtures/boi/. Used ONLY in explicit fixture mode (never on the Apify platform; see
 * resolveDataSource) so the smoke test and local development exercise the real URL builder and
 * the real response parsers without any network access.
 *
 * The fixture files are hand-built from the documented response shapes and are SYNTHETIC: their
 * numbers are not Bank of Israel rates. The test/ folder is excluded from the published build
 * (.actorignore / .dockerignore), so this mode cannot even start there.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_ADAPTER_CONFIG } from './lib/boi-adapter.js';
import type { HttpDeps, HttpResponseLike } from './lib/http.js';

export const FIXTURE_DIR = fileURLToPath(new URL('../test/fixtures/boi/', import.meta.url));

function response(status: number, body: string, contentType: string): HttpResponseLike {
  return {
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    text: () => Promise.resolve(body),
  };
}

/** Emulates the server-side period filter: keep the header and the rows whose TIME_PERIOD is inside [from, to]. */
function filterCsvByPeriod(csv: string, from: string | null, to: string | null): string {
  const lines = csv.split(/\r?\n/).filter((l) => l !== '');
  const header = lines[0];
  if (header === undefined) return '';
  const columns = header.split(',');
  const iTime = columns.indexOf('TIME_PERIOD');
  const kept = lines.slice(1).filter((line) => {
    const date = line.split(',')[iTime] ?? '';
    return (from === null || date >= from) && (to === null || date <= to);
  });
  return [header, ...kept].join('\n') + '\n';
}

export function createFixtureFetch(dir: string = FIXTURE_DIR): HttpDeps['fetch'] {
  if (!existsSync(dir)) {
    throw new Error(
      `Fixture mode needs the repository folder ${dir}, which is not part of the published build. Fixture mode only works from a checkout of the repository.`,
    );
  }
  return (url) => {
    const parsed = new URL(url);
    if (url.startsWith(DEFAULT_ADAPTER_CONFIG.sdmxDataUrl.split('?')[0] as string)) {
      const series = parsed.searchParams.get('c[SERIES_CODE]') ?? '';
      const file = `${dir}sdmx/${series}.csv`;
      if (!/^[A-Z_]+$/.test(series) || !existsSync(file)) return Promise.resolve(response(404, 'NoResultsFound', 'text/plain'));
      const body = filterCsvByPeriod(readFileSync(file, 'utf8'), parsed.searchParams.get('startperiod'), parsed.searchParams.get('endperiod'));
      return Promise.resolve(response(200, body, 'text/csv'));
    }
    if (parsed.pathname.endsWith('/GetExchangeRates')) {
      return Promise.resolve(response(200, readFileSync(`${dir}publicapi/latest.json`, 'utf8'), 'application/json'));
    }
    return Promise.resolve(response(404, 'not found', 'text/plain'));
  };
}
