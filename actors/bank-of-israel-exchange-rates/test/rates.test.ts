import { describe, expect, it } from 'vitest';
import { parseSdmxCsv, type RateObservation } from '../src/lib/boi-adapter.js';
import { addDays, diffDays } from '../src/lib/dates.js';
import { DEFAULT_RATE_RULE, lastIndexOnOrBefore, MAX_CARRY_DAYS, mergeObservations, RATE_RULES, type RateRule, resolveRate, upsertObservation } from '../src/lib/rates.js';
import { fixture, mulberry32 } from './helpers.js';

const obs = (date: string, rate = 3.5, extra: Partial<RateObservation> = {}): RateObservation => ({ date, rate, unit: 1, change: null, publishedAt: null, ...extra });

/** USD around Rosh Hashana 2024: published 09-29 (Sun) .. 10-02 (Wed), gap 10-03/04/05, published 10-06 (Sun) .. 10-08. */
const gap = parseSdmxCsv(fixture('cases/holiday-gap.csv'), 'USD').observations;
const dateOf = (r: ReturnType<typeof resolveRate>): string | null => (r.found ? r.observation.date : null);

describe('the three rules on the weekend / holiday gap fixture', () => {
  it('last-published-on-or-before: a publication day uses itself', () => {
    const r = resolveRate(gap, '2024-10-02', 'last-published-on-or-before');
    expect(r).toMatchObject({ found: true, daysBack: 0 });
    expect(dateOf(r)).toBe('2024-10-02');
  });

  it('last-published-on-or-before: holiday days carry the last publication forward', () => {
    for (const [date, back] of [['2024-10-03', 1], ['2024-10-04', 2], ['2024-10-05', 3]] as const) {
      const r = resolveRate(gap, date, 'last-published-on-or-before');
      expect(dateOf(r), date).toBe('2024-10-02');
      expect(r).toMatchObject({ found: true, daysBack: back });
    }
  });

  it('previous-business-day: strictly before the date, even on a publication day', () => {
    expect(dateOf(resolveRate(gap, '2024-10-02', 'previous-business-day'))).toBe('2024-10-01');
    expect(dateOf(resolveRate(gap, '2024-10-03', 'previous-business-day'))).toBe('2024-10-02');
    expect(dateOf(resolveRate(gap, '2024-10-05', 'previous-business-day'))).toBe('2024-10-02');
    expect(dateOf(resolveRate(gap, '2024-10-06', 'previous-business-day'))).toBe('2024-10-02'); // Sunday after the gap
    expect(resolveRate(gap, '2024-10-06', 'previous-business-day')).toMatchObject({ daysBack: 4 });
  });

  it('same-day: only a date with its own publication', () => {
    expect(dateOf(resolveRate(gap, '2024-10-02', 'same-day'))).toBe('2024-10-02');
    const holiday = resolveRate(gap, '2024-10-03', 'same-day');
    expect(holiday).toEqual({ found: false, detail: 'no rate was published on 2024-10-03' });
  });

  it('the default rule is last-published-on-or-before', () => {
    expect(DEFAULT_RATE_RULE).toBe('last-published-on-or-before');
    expect(RATE_RULES).toEqual(['last-published-on-or-before', 'previous-business-day', 'same-day']);
  });
});

describe('limits: before the series, empty series, stale data', () => {
  it('finds nothing before the first observation and says why', () => {
    for (const rule of ['last-published-on-or-before', 'previous-business-day'] as const) {
      const r = resolveRate(gap, '2024-09-20', rule);
      expect(r.found, rule).toBe(false);
    }
    const r = resolveRate(gap, '2024-09-29', 'previous-business-day');
    expect(r.found).toBe(false);
    if (!r.found) expect(r.detail).toMatch(/no rate was published in the 14 days before 2024-09-29/);
  });

  it('returns not-found for an empty series under every rule', () => {
    for (const rule of RATE_RULES) expect(resolveRate([], '2025-01-07', rule).found, rule).toBe(false);
  });

  it(`refuses to carry a rate over more than ${MAX_CARRY_DAYS} days (a stale or incomplete source is not a holiday)`, () => {
    const series = [obs('2025-01-01')];
    expect(resolveRate(series, addDays('2025-01-01', MAX_CARRY_DAYS), 'last-published-on-or-before').found).toBe(true);
    const stale = resolveRate(series, addDays('2025-01-01', MAX_CARRY_DAYS + 1), 'last-published-on-or-before');
    expect(stale.found).toBe(false);
    if (!stale.found) expect(stale.detail).toMatch(/15 days earlier.*refusing to carry it over/);
  });
});

describe('resolveRate against an independent linear-scan oracle (seeded random series)', () => {
  function oracle(series: readonly RateObservation[], date: string, rule: RateRule): string | null {
    let best: string | null = null;
    for (const o of series) {
      const ok = rule === 'same-day' ? o.date === date : rule === 'previous-business-day' ? o.date < date : o.date <= date;
      if (ok && (best === null || o.date > best)) best = o.date;
    }
    if (best === null) return null;
    return diffDays(date, best) > MAX_CARRY_DAYS ? null : best;
  }

  it('agrees for 3000 random (series, date, rule) triples', () => {
    const rnd = mulberry32(99);
    for (let i = 0; i < 3000; i++) {
      const start = addDays('2024-01-01', Math.floor(rnd() * 300));
      const series: RateObservation[] = [];
      const seen = new Set<string>();
      const n = Math.floor(rnd() * 40);
      for (let k = 0; k < n; k++) {
        const d = addDays(start, Math.floor(rnd() * 90));
        if (!seen.has(d)) {
          seen.add(d);
          series.push(obs(d, 3 + rnd()));
        }
      }
      series.sort((a, b) => (a.date < b.date ? -1 : 1));
      const date = addDays(start, Math.floor(rnd() * 120) - 15);
      const rule = RATE_RULES[Math.floor(rnd() * 3)] as RateRule;
      expect(dateOf(resolveRate(series, date, rule)), `${rule} ${date} ${series.map((s) => s.date).join(',')}`).toBe(oracle(series, date, rule));
    }
  });
});

describe('lastIndexOnOrBefore / mergeObservations / upsertObservation', () => {
  it('binary search returns -1, the exact index, or the previous one', () => {
    const s = [obs('2025-01-02'), obs('2025-01-05'), obs('2025-01-09')];
    expect(lastIndexOnOrBefore(s, '2025-01-01')).toBe(-1);
    expect(lastIndexOnOrBefore(s, '2025-01-02')).toBe(0);
    expect(lastIndexOnOrBefore(s, '2025-01-04')).toBe(0);
    expect(lastIndexOnOrBefore(s, '2025-01-09')).toBe(2);
    expect(lastIndexOnOrBefore(s, '2030-01-01')).toBe(2);
    expect(lastIndexOnOrBefore([], '2025-01-01')).toBe(-1);
  });

  it('merges windows, prefers the richer observation on overlap and keeps ascending order', () => {
    const a = [obs('2025-01-05', 3.1), obs('2025-01-06', 3.2)];
    const b = [obs('2025-01-06', 3.2, { change: 0.5 }), obs('2025-01-07', 3.3)];
    const merged = mergeObservations(b, a);
    expect(merged.map((o) => o.date)).toEqual(['2025-01-05', '2025-01-06', '2025-01-07']);
    expect(merged[1]?.change).toBe(0.5);
    const withTs = mergeObservations(a, [obs('2025-01-05', 3.1, { publishedAt: '2025-01-05T13:30:00.000Z' })]);
    expect(withTs[0]?.publishedAt).toBe('2025-01-05T13:30:00.000Z');
  });

  it('upsert replaces the same date and inserts a new one in order', () => {
    const s = [obs('2025-01-05', 1), obs('2025-01-07', 2)];
    expect(upsertObservation(s, obs('2025-01-07', 9)).map((o) => o.rate)).toEqual([1, 9]);
    expect(upsertObservation(s, obs('2025-01-06', 5)).map((o) => o.date)).toEqual(['2025-01-05', '2025-01-06', '2025-01-07']);
    expect(s).toHaveLength(2); // input not mutated
  });
});
