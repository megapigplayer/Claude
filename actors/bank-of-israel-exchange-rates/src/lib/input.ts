/**
 * Input normalisation for Bank of Israel Exchange Rates (pure: no Apify imports, unit-tested).
 *
 * - No INPUT at all, `{}`, or a run carrying only schema defaults (rateRule, maxItems) -> the
 *   built-in demo input (DEFAULT_INPUT, identical to the prefill in .actor/input_schema.json):
 *   one currency, one fixed recent date. The platform's daily health run must never fail.
 * - Work-defining fields (currencies / dateFrom / dateTo / conversions) that are present but
 *   unusable -> InputError (never run the demo for a caller whose own list was empty).
 * - Dates: `YYYY-MM-DD` or the word `today` (Israel time). Everything is validated here; the
 *   words "today" are resolved later, against the run's clock, by plan.ts.
 */
import { parseDateInput } from './dates.js';
import { DEFAULT_RATE_RULE, RATE_RULES, type RateRule } from './rates.js';

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

export type DataSourceChoice = 'live' | 'fixtures';

export interface ActorInput {
  /** As typed by the caller (codes, symbols or names); resolved per entry in plan.ts. */
  currencies: string[];
  /** `YYYY-MM-DD` or `today`; null = not given. */
  dateFrom: string | null;
  dateTo: string | null;
  /** Raw entries; each is validated on its own in plan.ts so one bad invoice never fails the run. */
  conversions: unknown[];
  rateRule: RateRule;
  maxItems: number;
  /** Undocumented testing switch (see resolveDataSource); null = automatic. */
  dataSource: DataSourceChoice | null;
}

export const MAX_ITEMS_LIMIT = 100_000;
export const DEFAULT_MAX_ITEMS = 5_000;

/**
 * Mirror of the prefill/default values in .actor/input_schema.json (a unit test enforces it).
 * One currency, one fixed recent business day (Wednesday 2026-09-23): tiny, deterministic, and
 * cheap for the platform's daily run.
 */
export const DEFAULT_INPUT: ActorInput = {
  currencies: ['USD'],
  dateFrom: '2026-09-23',
  dateTo: '2026-09-23',
  conversions: [],
  rateRule: DEFAULT_RATE_RULE,
  maxItems: DEFAULT_MAX_ITEMS,
  dataSource: null,
};

function demoInput(): ActorInput {
  return { ...DEFAULT_INPUT, currencies: [...DEFAULT_INPUT.currencies], conversions: [] };
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function readRateRule(raw: unknown): RateRule {
  if (isBlank(raw)) return DEFAULT_RATE_RULE;
  const text = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/_/g, '-') : '';
  const rule = RATE_RULES.find((r) => r === text);
  if (!rule) throw new InputError(`Input field "rateRule" must be one of: ${RATE_RULES.join(', ')}.`);
  return rule;
}

function readDataSource(raw: unknown): DataSourceChoice | null {
  if (isBlank(raw)) return null;
  if (raw === 'live' || raw === 'fixtures') return raw;
  throw new InputError('Input field "dataSource" must be "live" or "fixtures".');
}

function readMaxItems(raw: unknown): number {
  if (raw === undefined || raw === null) return DEFAULT_MAX_ITEMS;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) throw new InputError('Input field "maxItems" must be a number >= 1.');
  return Math.min(Math.floor(raw), MAX_ITEMS_LIMIT);
}

/** A list, or a single text such as "USD, EUR" / "USD EUR" / "USD;EUR". Blank entries are dropped. */
function readCurrencies(raw: unknown): string[] {
  let list: unknown[];
  if (Array.isArray(raw)) list = raw;
  else if (typeof raw === 'string') list = raw.split(/[,;\s]+/);
  else throw new InputError('Input field "currencies" must be a list of currency codes such as ["USD", "EUR"].');
  return list
    .map((x) => (typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : ''))
    .filter((x) => x !== '');
}

function readDate(field: 'dateFrom' | 'dateTo', raw: unknown): string | null {
  if (isBlank(raw)) return null;
  const parsed = parseDateInput(raw, new Date(0));
  if (!parsed.ok) throw new InputError(`Input field "${field}": ${parsed.reason}.`);
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'today' ? 'today' : parsed.iso;
}

export function normalizeInput(raw: unknown): ActorInput {
  if (raw === null || raw === undefined) return demoInput();
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new InputError('Input must be a JSON object.');
  const obj = raw as Record<string, unknown>;

  const rateRule = readRateRule(obj.rateRule);
  const maxItems = readMaxItems(obj.maxItems);
  const dataSource = readDataSource(obj.dataSource);

  const hasCurrencies = obj.currencies !== undefined && obj.currencies !== null;
  const hasConversions = obj.conversions !== undefined && obj.conversions !== null;
  const hasFrom = !isBlank(obj.dateFrom);
  const hasTo = !isBlank(obj.dateTo);
  if (!hasCurrencies && !hasConversions && !hasFrom && !hasTo) {
    return { ...demoInput(), rateRule, maxItems, dataSource };
  }

  const currencies = hasCurrencies ? readCurrencies(obj.currencies) : [];
  let conversions: unknown[] = [];
  if (hasConversions) {
    if (!Array.isArray(obj.conversions)) {
      throw new InputError('Input field "conversions" must be a list of objects such as {"amount": 1200, "currency": "USD", "date": "2025-01-07"}.');
    }
    conversions = obj.conversions;
  }

  if (currencies.length === 0 && conversions.length === 0) {
    throw new InputError(
      hasFrom || hasTo
        ? 'Input fields "dateFrom"/"dateTo" need at least one currency in "currencies".'
        : 'Nothing to do: "currencies" and "conversions" are both empty. Add at least one currency (for example ["USD"]) or one conversion.',
    );
  }

  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  if (currencies.length > 0) {
    dateTo = readDate('dateTo', obj.dateTo);
    dateFrom = readDate('dateFrom', obj.dateFrom);
    // Partial input from an API caller: "USD" alone means today's rate; a single date means a one-day range.
    if (dateTo === null) dateTo = dateFrom ?? 'today';
    if (dateFrom === null) dateFrom = dateTo;
  } else {
    // Conversions only: still validate dates the caller wrote, but they are not used.
    readDate('dateFrom', obj.dateFrom);
    readDate('dateTo', obj.dateTo);
  }
  return { currencies, dateFrom, dateTo, conversions, rateRule, maxItems, dataSource };
}

export interface DataSourceDecision {
  source: DataSourceChoice;
  reason: string;
}

/**
 * Which data the run uses.
 * - On the Apify platform (`isAtHome`) it is ALWAYS the live Bank of Israel service; asking for
 *   fixtures there is an error, so synthetic data can never reach a paying user.
 * - Outside the platform (unit tests, `apify run`, this repo's offline smoke test) fixtures are the
 *   default because the build environment has no network access to the BOI; a developer who wants
 *   live data locally must say so explicitly (`"dataSource": "live"` or env BOI_DATA_SOURCE=live).
 */
export function resolveDataSource(args: {
  inputValue: DataSourceChoice | null;
  envValue: string | undefined;
  isAtHome: boolean;
}): DataSourceDecision {
  let explicit: DataSourceChoice | null = args.inputValue;
  let via = 'the "dataSource" input field';
  if (explicit === null && args.envValue !== undefined && args.envValue.trim() !== '') {
    const env = args.envValue.trim().toLowerCase();
    if (env !== 'live' && env !== 'fixtures') throw new InputError('Environment variable BOI_DATA_SOURCE must be "live" or "fixtures".');
    explicit = env;
    via = 'environment variable BOI_DATA_SOURCE';
  }
  if (args.isAtHome) {
    if (explicit === 'fixtures') {
      throw new InputError('dataSource "fixtures" (synthetic test data) is not available on the Apify platform. Remove it to get live Bank of Israel rates.');
    }
    return { source: 'live', reason: 'Apify platform run: live Bank of Israel data' };
  }
  if (explicit !== null) return { source: explicit, reason: `chosen explicitly via ${via}` };
  return {
    source: 'fixtures',
    reason: 'local run outside the Apify platform: default is the bundled fixtures (no network needed); set "dataSource": "live" to query the Bank of Israel',
  };
}
