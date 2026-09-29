import { describe, expect, it } from 'vitest';
import type { RateObservation } from '../src/lib/boi-adapter.js';
import type { SourceFailure } from '../src/lib/load.js';
import type { ConversionEntry, Entry, RateEntry } from '../src/lib/plan.js';
import { addToSummary, buildRow, buildRows, emptySummary, FINAL_MINUTES_OF_DAY, isProvisional, type ResultRow, type RowContext, safeBuildRow } from '../src/lib/process.js';
import type { RateRule } from '../src/lib/rates.js';
import { mulberry32 } from './helpers.js';

const obs = (date: string, rate: number, extra: Partial<RateObservation> = {}): RateObservation => ({ date, rate, unit: 1, change: null, publishedAt: null, ...extra });
const USD = [obs('2025-01-02', 3.642), obs('2025-01-05', 3.647, { change: 0.137 }), obs('2025-01-06', 3.655)];

function ctx(over: Partial<RowContext> = {}): RowContext {
  return {
    rule: 'last-published-on-or-before',
    now: new Date('2026-09-29T10:00:00Z'),
    today: '2026-09-29',
    dataSource: 'live',
    series: new Map([['USD', USD], ['JPY', [obs('2025-01-07', 2.3118, { change: null })].map((o) => ({ ...o, unit: 100 }))]]),
    failures: new Map(),
    stats: { skippedNoPublication: 0 },
    ...over,
  };
}
const rate = (currency: string, date: string | null, problem: RateEntry['problem'] = null): RateEntry => ({ kind: 'rate', currency, date, problem });
const conv = (over: Partial<ConversionEntry> = {}): ConversionEntry => ({ kind: 'conversion', position: 1, reference: null, amount: 1200, currency: 'USD', date: '2025-01-05', problem: null, ...over });

const RATE_KEYS = ['rowType', 'ok', 'reasonCode', 'reason', 'date', 'currency', 'rate', 'unit', 'change', 'publishedAt', 'provisional', 'rateDate', 'daysBack', 'ruleApplied', 'dataSource'];
const CONVERSION_KEYS = ['rowType', 'ok', 'reasonCode', 'reason', 'position', 'reference', 'amount', 'currency', 'date', 'rateUsed', 'unit', 'rateDate', 'daysBack', 'ruleApplied', 'ilsAmount', 'publishedAt', 'provisional', 'dataSource'];

describe('rate rows', () => {
  it('answers a publication day with its own rate', () => {
    expect(buildRow(rate('USD', '2025-01-05'), ctx())).toEqual({
      rowType: 'rate', ok: true, reasonCode: 'OK', reason: 'Rate published on 2025-01-05.', date: '2025-01-05', currency: 'USD', rate: 3.647, unit: 1, change: 0.137,
      publishedAt: null, provisional: false, rateDate: '2025-01-05', daysBack: 0, ruleApplied: 'last-published-on-or-before', dataSource: 'live',
    });
  });

  it('carries the last publication over a gap and says which day was used', () => {
    const row = buildRow(rate('USD', '2025-01-04'), ctx()) as ResultRow;
    expect(row).toMatchObject({ ok: true, date: '2025-01-04', rateDate: '2025-01-02', daysBack: 2, rate: 3.642 });
    expect(row.reason).toBe('No rate was published on 2025-01-04; used the last one published before it, on 2025-01-02 (2 days earlier).');
  });

  it('previous-business-day words its reason accordingly', () => {
    const row = buildRow(rate('USD', '2025-01-06'), ctx({ rule: 'previous-business-day' })) as ResultRow;
    expect(row).toMatchObject({ rateDate: '2025-01-05', daysBack: 1, ruleApplied: 'previous-business-day' });
    expect(row.reason).toBe('Used the rate of the last publication before 2025-01-06: 2025-01-05 (1 day earlier).');
  });

  it('same-day skips a range date without a publication (counted, not silent) but answers publication days', () => {
    const c = ctx({ rule: 'same-day' });
    expect(buildRow(rate('USD', '2025-01-04'), c)).toBeNull();
    expect(c.stats.skippedNoPublication).toBe(1);
    expect(buildRow(rate('USD', '2025-01-05'), c)).toMatchObject({ ok: true, daysBack: 0 });
  });

  it('other rules give a free NO_RATE_PUBLISHED notice when nothing applies', () => {
    const row = buildRow(rate('USD', '2024-01-01'), ctx()) as ResultRow;
    expect(row).toMatchObject({ ok: false, reasonCode: 'NO_RATE_PUBLISHED', rate: null, rateDate: null });
    expect(row.reason).toMatch(/^USD: no rate was published on or in the 14 days before 2024-01-01/);
  });

  it('turns entry problems into notice rows (unknown currency in a range has no date)', () => {
    const row = buildRow(rate('XYZ', null, { reasonCode: 'UNKNOWN_CURRENCY', reason: 'nope' }), ctx());
    expect(row).toMatchObject({ rowType: 'rate', ok: false, reasonCode: 'UNKNOWN_CURRENCY', reason: 'nope', currency: 'XYZ', date: null });
  });

  it('turns a source failure into a SOURCE_* notice for that currency only', () => {
    const failures = new Map<string, SourceFailure>([['USD', { code: 'SOURCE_UNAVAILABLE', message: 'BOI unreachable' }]]);
    expect(buildRow(rate('USD', '2025-01-05'), ctx({ failures }))).toMatchObject({ ok: false, reasonCode: 'SOURCE_UNAVAILABLE', reason: 'BOI unreachable' });
    expect(buildRow(rate('JPY', '2025-01-07'), ctx({ failures }))).toMatchObject({ ok: true });
  });

  it('labels the data source on every row', () => {
    expect(buildRow(rate('USD', '2025-01-05'), ctx({ dataSource: 'fixtures' }))).toMatchObject({ dataSource: 'fixtures' });
  });

  it('has exactly the documented keys, in order', () => {
    expect(Object.keys(buildRow(rate('USD', '2025-01-05'), ctx()) as object)).toEqual(RATE_KEYS);
    expect(Object.keys(buildRow(rate('XYZ', null, { reasonCode: 'UNKNOWN_CURRENCY', reason: 'x' }), ctx()) as object)).toEqual(RATE_KEYS);
  });
});

describe('conversion rows', () => {
  it('converts at the rate of the invoice date and echoes position and reference', () => {
    const row = buildRow(conv({ position: 3, reference: 'INV-9' }), ctx()) as ResultRow;
    expect(row).toEqual({
      rowType: 'conversion', ok: true, reasonCode: 'OK', reason: 'Rate published on 2025-01-05.', position: 3, reference: 'INV-9', amount: 1200, currency: 'USD', date: '2025-01-05',
      rateUsed: 3.647, unit: 1, rateDate: '2025-01-05', daysBack: 0, ruleApplied: 'last-published-on-or-before', ilsAmount: 4376.4, publishedAt: null, provisional: false, dataSource: 'live',
    });
  });

  it('the invoice-date rule: a Friday/Saturday invoice uses the last rate published before it', () => {
    const row = buildRow(conv({ date: '2025-01-04', amount: 100 }), ctx()) as ResultRow;
    expect(row).toMatchObject({ rateUsed: 3.642, rateDate: '2025-01-02', daysBack: 2, ilsAmount: 364.2 });
  });

  it('respects the unit (JPY per 100)', () => {
    const row = buildRow(conv({ currency: 'JPY', amount: 100_000, date: '2025-01-07' }), ctx()) as ResultRow;
    expect(row).toMatchObject({ rateUsed: 2.3118, unit: 100, ilsAmount: 2311.8 });
  });

  it('same-day conversions on a non-publication date get a NO_RATE_PUBLISHED notice (never skipped)', () => {
    const row = buildRow(conv({ date: '2025-01-04' }), ctx({ rule: 'same-day' })) as ResultRow;
    expect(row).toMatchObject({ rowType: 'conversion', ok: false, reasonCode: 'NO_RATE_PUBLISHED', ilsAmount: null, rateUsed: null });
  });

  it('carries entry problems (invalid amount / unknown currency / future date) as free notices with the caller data echoed', () => {
    const row = buildRow(conv({ amount: null, currency: 'XYZ', date: '07/01/2025', reference: 'INV-1', problem: { reasonCode: 'UNKNOWN_CURRENCY', reason: 'x' } }), ctx());
    expect(row).toMatchObject({ ok: false, reasonCode: 'UNKNOWN_CURRENCY', currency: 'XYZ', date: '07/01/2025', reference: 'INV-1', amount: null, ilsAmount: null });
  });

  it('never produces NaN or absurd results from a hand-built entry with a bad amount', () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, 1e300, null as unknown as number]) {
      expect(buildRow(conv({ amount }), ctx()), String(amount)).toMatchObject({ ok: false, reasonCode: 'INVALID_AMOUNT', ilsAmount: null });
    }
  });

  it('keeps negative amounts (credit notes) and zero', () => {
    expect((buildRow(conv({ amount: -50, date: '2025-01-05' }), ctx()) as ResultRow & { ilsAmount: number }).ilsAmount).toBe(-182.35);
    expect((buildRow(conv({ amount: 0 }), ctx()) as ResultRow & { ilsAmount: number }).ilsAmount).toBe(0);
  });

  it('has exactly the documented keys, in order', () => {
    expect(Object.keys(buildRow(conv(), ctx()) as object)).toEqual(CONVERSION_KEYS);
    expect(Object.keys(buildRow(conv({ problem: { reasonCode: 'INVALID_AMOUNT', reason: 'x' } }), ctx()) as object)).toEqual(CONVERSION_KEYS);
  });
});

describe('provisional rates (revised about 15 minutes after publication, VERIFY(BOI-10))', () => {
  const today = '2026-09-29';
  it('without a publication timestamp: today before 15:45 Israel time is provisional, later or earlier days are not', () => {
    const o = obs(today, 3.2);
    expect(isProvisional(o, new Date('2026-09-29T12:44:00Z'), today)).toBe(true); // 15:44 IDT
    expect(isProvisional(o, new Date('2026-09-29T12:45:00Z'), today)).toBe(false); // 15:45 IDT
    expect(FINAL_MINUTES_OF_DAY).toBe(945);
    expect(isProvisional(obs('2026-09-28', 3.2), new Date('2026-09-29T06:00:00Z'), today)).toBe(false);
    expect(isProvisional(o, new Date('2026-09-29T05:00:00Z'), today)).toBe(true); // morning: today's rate is not even published yet
  });

  it('with a timestamp: provisional until 15 minutes after publication', () => {
    const published = obs(today, 3.2, { publishedAt: '2026-09-29T12:30:00.000Z' });
    expect(isProvisional(published, new Date('2026-09-29T12:44:59Z'), today)).toBe(true);
    expect(isProvisional(published, new Date('2026-09-29T12:45:00Z'), today)).toBe(false);
    expect(isProvisional(published, new Date('2026-09-29T12:00:00Z'), today)).toBe(true); // clock skew: published "in the future"
  });

  it('flows into the row and the reason', () => {
    const series = new Map([['USD', [obs(today, 3.2)]]]);
    const row = buildRow(rate('USD', today), ctx({ series, now: new Date('2026-09-29T09:00:00Z') })) as ResultRow;
    expect(row).toMatchObject({ ok: true, provisional: true });
    expect(row.reason).toMatch(/Provisional: today's rate may still be revised\.$/);
  });
});

describe('safeBuildRow and buildRows never throw', () => {
  it('turns an unexpected exception into one INTERNAL_ERROR row of the right shape', () => {
    const boom = new Map() as unknown as RowContext['series'];
    (boom as unknown as Map<string, unknown>).get = () => {
      throw new Error('kaboom');
    };
    const c = ctx({ series: boom });
    expect(safeBuildRow(rate('USD', '2025-01-05'), c)).toMatchObject({ rowType: 'rate', ok: false, reasonCode: 'INTERNAL_ERROR' });
    const conversion = safeBuildRow(conv(), c) as ResultRow;
    expect(conversion).toMatchObject({ rowType: 'conversion', ok: false, reasonCode: 'INTERNAL_ERROR' });
    expect(conversion.reason).toMatch(/kaboom/);
  });

  it('buildRows yields rows in order and drops only same-day gaps', () => {
    const entries: Entry[] = [rate('USD', '2025-01-04'), rate('USD', '2025-01-05'), conv()];
    const rows = [...buildRows(entries, ctx({ rule: 'same-day' }))];
    expect(rows.map((r) => r.rowType)).toEqual(['rate', 'conversion']);
  });

  it('survives 2000 random hostile entries (fuzz, seeded)', () => {
    const rnd = mulberry32(31337);
    const pick = <T>(list: T[]): T => list[Math.floor(rnd() * list.length)] as T;
    const rules: RateRule[] = ['last-published-on-or-before', 'previous-business-day', 'same-day'];
    for (let i = 0; i < 2000; i++) {
      const c = ctx({ rule: pick(rules) });
      const entry: Entry =
        rnd() < 0.5
          ? rate(pick(['USD', 'JPY', 'XYZ', '', 'usd']), pick(['2025-01-05', '2025-01-04', '1900-01-01', '2999-12-31', null as unknown as string, 'garbage']))
          : conv({ amount: pick([1200, 0, -1, Number.NaN, 1e300, null as unknown as number]), currency: pick(['USD', 'JPY', 'XYZ']), date: pick(['2025-01-05', 'x', null as unknown as string]) });
      const row = safeBuildRow(entry, c);
      if (row === null) continue;
      expect(Object.keys(row)).toEqual(row.rowType === 'rate' ? RATE_KEYS : CONVERSION_KEYS);
      expect(typeof row.ok).toBe('boolean');
      expect(row.reasonCode).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe('run summary', () => {
  it('counts rows, kinds and reason codes', () => {
    const plan = { rateRule: 'same-day', today: '2026-09-29', totalRequested: 4, truncatedByMaxItems: 1, clampedRangeEnd: false, warnings: ['w'] } as unknown as Parameters<typeof emptySummary>[0];
    const s = emptySummary(plan, 'fixtures');
    for (const e of [rate('USD', '2025-01-05'), rate('XYZ', null, { reasonCode: 'UNKNOWN_CURRENCY', reason: 'x' }), conv()]) addToSummary(s, buildRow(e, ctx()) as ResultRow);
    expect(s).toMatchObject({ dataSource: 'fixtures', rateRule: 'same-day', requestedRows: 4, rows: 3, rateRows: 2, conversionRows: 1, okRows: 2, problemRows: 1, truncatedByMaxItems: 1, warnings: ['w'] });
    expect(s.byReasonCode).toEqual({ OK: 2, UNKNOWN_CURRENCY: 1 });
  });
});
