import { describe, expect, it } from 'vitest';
import { addDays, diffDays } from '../src/lib/dates.js';
import { type ActorInput, DEFAULT_INPUT, InputError, normalizeInput } from '../src/lib/input.js';
import { buildConversionEntry, buildPlan, buildWindows, type ConversionEntry, type Entry, MAX_RANGE_DAYS, MAX_WINDOW_DAYS, MAX_WINDOWS } from '../src/lib/plan.js';
import { MAX_CARRY_DAYS } from '../src/lib/rates.js';

const NOW = new Date('2026-09-29T10:00:00Z'); // Tuesday 2026-09-29, 13:00 in Israel
const input = (over: Partial<ActorInput>): ActorInput => ({ ...DEFAULT_INPUT, currencies: [], dateFrom: null, dateTo: null, conversions: [], ...over });
const rateEntries = (entries: Entry[]) => entries.filter((e) => e.kind === 'rate').map((e) => [e.currency, e.date]);

describe('buildPlan: the demo input', () => {
  it('is one row and one small source request (the daily run stays tiny)', () => {
    const plan = buildPlan(normalizeInput({}), NOW);
    expect(plan.entries).toEqual([{ kind: 'rate', currency: 'USD', date: '2026-09-23', problem: null }]);
    expect(plan.windows).toEqual([{ currency: 'USD', from: addDays('2026-09-23', -MAX_CARRY_DAYS), to: '2026-09-23' }]);
    expect(plan).toMatchObject({ today: '2026-09-29', totalRequested: 1, truncatedByMaxItems: 0, clampedRangeEnd: false, currencies: ['USD'] });
  });
});

describe('buildPlan: range rows', () => {
  it('orders rows date by date, then in the caller currency order (3 currencies x 5 dates)', () => {
    const plan = buildPlan(input({ currencies: ['USD', 'EUR', 'JPY'], dateFrom: '2025-01-05', dateTo: '2025-01-09' }), NOW);
    expect(plan.entries).toHaveLength(15);
    expect(rateEntries(plan.entries).slice(0, 4)).toEqual([['USD', '2025-01-05'], ['EUR', '2025-01-05'], ['JPY', '2025-01-05'], ['USD', '2025-01-06']]);
    expect(rateEntries(plan.entries).at(-1)).toEqual(['JPY', '2025-01-09']);
    expect(plan.windows).toEqual([
      { currency: 'USD', from: '2024-12-22', to: '2025-01-09' },
      { currency: 'EUR', from: '2024-12-22', to: '2025-01-09' },
      { currency: 'JPY', from: '2024-12-22', to: '2025-01-09' },
    ]);
  });

  it('resolves aliases, drops duplicate currencies and turns unknown ones into one free notice each', () => {
    const plan = buildPlan(input({ currencies: ['usd', 'דולר', 'XYZ', 'xyz', 'EUR'], dateFrom: '2025-01-05', dateTo: '2025-01-06' }), NOW);
    expect(plan.entries[0]).toMatchObject({ kind: 'rate', currency: 'XYZ', date: null, problem: { reasonCode: 'UNKNOWN_CURRENCY' } });
    expect(plan.entries.filter((e) => e.problem === null).map((e) => [e.currency, e.kind === 'rate' ? e.date : null])).toEqual([
      ['USD', '2025-01-05'], ['EUR', '2025-01-05'], ['USD', '2025-01-06'], ['EUR', '2025-01-06'],
    ]);
    expect(plan.currencies).toEqual(['USD', 'EUR']);
  });

  it('fails when NONE of the requested currencies is supported and there is nothing else to do', () => {
    expect(() => buildPlan(input({ currencies: ['XYZ', 'CNH'], dateFrom: '2025-01-05', dateTo: '2025-01-06' }), NOW)).toThrow(InputError);
    expect(() => buildPlan(input({ currencies: ['XYZ'], dateFrom: '2025-01-05', dateTo: '2025-01-06' }), NOW)).toThrow(/None of the requested currencies/);
  });

  it('still answers the conversions when the range currencies are all unknown', () => {
    const plan = buildPlan(input({ currencies: ['XYZ'], dateFrom: '2025-01-05', dateTo: '2025-01-06', conversions: [{ amount: 10, currency: 'USD', date: '2025-01-05' }] }), NOW);
    expect(plan.entries.map((e) => e.kind)).toEqual(['rate', 'conversion']);
    expect(plan.entries[0]?.problem?.reasonCode).toBe('UNKNOWN_CURRENCY');
  });

  it('resolves "today" with the Israeli clock', () => {
    const plan = buildPlan(input({ currencies: ['USD'], dateFrom: 'today', dateTo: 'today' }), new Date('2026-09-29T21:30:00Z'));
    expect(plan.entries).toEqual([{ kind: 'rate', currency: 'USD', date: '2026-09-30', problem: null }]); // already Wednesday in Israel
    expect(plan.today).toBe('2026-09-30');
  });

  it('rejects an inverted range, a range that starts in the future and an over-long range', () => {
    expect(() => buildPlan(input({ currencies: ['USD'], dateFrom: '2025-01-09', dateTo: '2025-01-05' }), NOW)).toThrow(/after "dateTo"/);
    expect(() => buildPlan(input({ currencies: ['USD'], dateFrom: '2026-10-01', dateTo: '2026-10-05' }), NOW)).toThrow(/dateFrom.*in the future/);
    expect(() => buildPlan(input({ currencies: ['USD'], dateFrom: '2010-01-01', dateTo: '2025-01-05' }), NOW)).toThrow(new RegExp(`maximum is ${MAX_RANGE_DAYS}`));
    expect(() => buildPlan(input({ currencies: ['USD'], dateFrom: '2025-01-05', dateTo: '2025-01-05' }), NOW)).not.toThrow();
  });

  it('cuts a range that ends in the future back to today and says so', () => {
    const plan = buildPlan(input({ currencies: ['USD'], dateFrom: '2026-09-27', dateTo: '2026-12-31' }), NOW);
    expect(plan.rangeTo).toBe('2026-09-29');
    expect(plan.clampedRangeEnd).toBe(true);
    expect(plan.entries.map((e) => (e.kind === 'rate' ? e.date : null))).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
    expect(plan.warnings.join(' ')).toMatch(/in the future; the range ends today \(2026-09-29/);
  });

  it('applies maxItems from the end, reports the cut, and only fetches what the kept rows need', () => {
    const plan = buildPlan(input({ currencies: ['USD', 'EUR'], dateFrom: '2025-01-05', dateTo: '2025-01-09', maxItems: 3 }), NOW);
    expect(plan.entries).toHaveLength(3);
    expect(plan).toMatchObject({ totalRequested: 10, truncatedByMaxItems: 7 });
    expect(plan.warnings.join(' ')).toMatch(/10 rows were requested; only the first 3/);
    expect(plan.windows).toEqual([
      { currency: 'USD', from: '2024-12-22', to: '2025-01-06' },
      { currency: 'EUR', from: '2024-12-22', to: '2025-01-05' },
    ]);
  });

  it('splits a range longer than one request into overlapping pieces so carried rates survive the seam', () => {
    const plan = buildPlan(input({ currencies: ['USD'], dateFrom: '2016-01-01', dateTo: '2025-12-31' }), NOW);
    expect(plan.windows.length).toBe(2);
    const [a, b] = plan.windows;
    expect(diffDays(a!.to, a!.from) + 1).toBe(MAX_WINDOW_DAYS);
    expect(diffDays(a!.to, b!.from) + 1).toBe(MAX_CARRY_DAYS); // overlap
    expect(b!.to).toBe('2025-12-31');
  });
});

describe('buildConversionEntry', () => {
  const build = (raw: unknown, position = 1): ConversionEntry => buildConversionEntry(raw, position, NOW, '2026-09-29');

  it('accepts a good conversion and normalises its parts', () => {
    expect(build({ amount: '1,200.50', currency: 'usd', date: '2025-01-07T00:00:00Z', reference: ' INV-1 ' }, 4)).toEqual({
      kind: 'conversion', position: 4, reference: 'INV-1', amount: 1200.5, currency: 'USD', date: '2025-01-07', problem: null,
    });
    expect(build({ amount: 5, currency: '€', date: 'today' }).date).toBe('2026-09-29');
    expect(build({ amount: 5, currency: 'EUR', date: '2025-01-07', reference: 42 }).reference).toBe('42');
  });

  it('reports each kind of problem with a stable reason code', () => {
    expect(build({ amount: 'abc', currency: 'USD', date: '2025-01-07' }).problem).toMatchObject({ reasonCode: 'INVALID_AMOUNT' });
    expect(build({ amount: 5, currency: 'XYZ', date: '2025-01-07' })).toMatchObject({ currency: 'XYZ', problem: { reasonCode: 'UNKNOWN_CURRENCY' } });
    expect(build({ amount: 5, currency: 'USD', date: '07/01/2025' })).toMatchObject({ date: '07/01/2025', problem: { reasonCode: 'INVALID_DATE' } });
    expect(build({ amount: 5, currency: 'USD' })).toMatchObject({ date: null, problem: { reasonCode: 'INVALID_DATE' } });
    expect(build({ amount: 5, currency: 'USD', date: '2026-09-30' }).problem).toMatchObject({ reasonCode: 'DATE_IN_FUTURE' });
    expect(build('junk').problem).toMatchObject({ reasonCode: 'INVALID_CONVERSION' });
    expect(build(null).problem).toMatchObject({ reasonCode: 'INVALID_CONVERSION' });
    expect(build([1, 2]).problem).toMatchObject({ reasonCode: 'INVALID_CONVERSION' });
  });

  it('lists every problem in the reason but uses the first one as the code', () => {
    const e = build({ amount: 'x', currency: 'XYZ', date: 'never' });
    expect(e.problem?.reasonCode).toBe('INVALID_AMOUNT');
    expect(e.problem?.reason).toMatch(/amount:.*; currency:.*; date:/);
  });

  it('allows today itself but not tomorrow, and keeps negative amounts (credit notes)', () => {
    expect(build({ amount: -50, currency: 'USD', date: '2026-09-29' })).toMatchObject({ amount: -50, problem: null });
  });
});

describe('buildPlan: conversions', () => {
  it('appends conversions after the range rows, with 1-based positions', () => {
    const plan = buildPlan(input({ currencies: ['USD'], dateFrom: '2025-01-05', dateTo: '2025-01-05', conversions: [{ amount: 1, currency: 'USD', date: '2025-01-06' }, 'junk'] }), NOW);
    expect(plan.entries.map((e) => (e.kind === 'conversion' ? e.position : 0))).toEqual([0, 1, 2]);
    expect(plan.totalRequested).toBe(3);
  });

  it('counts conversions towards maxItems', () => {
    const conversions = Array.from({ length: 5 }, () => ({ amount: 1, currency: 'USD', date: '2025-01-06' }));
    const plan = buildPlan(input({ conversions, maxItems: 2 }), NOW);
    expect(plan.entries).toHaveLength(2);
    expect(plan.truncatedByMaxItems).toBe(3);
  });
});

describe('buildWindows', () => {
  const conv = (currency: string, date: string): ConversionEntry => ({ kind: 'conversion', position: 1, reference: null, amount: 1, currency, date, problem: null });

  it('merges conversion dates that are close together into one request per currency', () => {
    const windows = buildWindows([conv('USD', '2025-01-07'), conv('USD', '2025-02-10'), conv('EUR', '2025-01-07')]);
    expect(windows).toEqual([
      { currency: 'USD', from: '2024-12-24', to: '2025-02-10' },
      { currency: 'EUR', from: '2024-12-24', to: '2025-01-07' },
    ]);
  });

  it('keeps far-apart conversion dates in separate requests', () => {
    const windows = buildWindows([conv('USD', '2020-03-02'), conv('USD', '2025-01-07')]);
    expect(windows).toEqual([
      { currency: 'USD', from: '2020-02-17', to: '2020-03-02' },
      { currency: 'USD', from: '2024-12-24', to: '2025-01-07' },
    ]);
  });

  it('never exceeds the request cap: sparse dates are merged more aggressively', () => {
    const entries: Entry[] = [];
    for (let i = 0; i < 400; i++) entries.push(conv('USD', addDays('2015-01-01', i * 9)));
    for (const c of ['EUR', 'GBP', 'JPY']) for (let i = 0; i < 100; i++) entries.push(conv(c, addDays('2015-01-01', i * 30)));
    const windows = buildWindows(entries);
    expect(windows.length).toBeLessThanOrEqual(MAX_WINDOWS);
    // every conversion date is still covered, with the carry-over lookback
    for (const e of entries) {
      if (e.kind !== 'conversion' || e.date === null) continue;
      expect(windows.some((w) => w.currency === e.currency && w.from <= addDays(e.date as string, -MAX_CARRY_DAYS) && w.to >= (e.date as string))).toBe(true);
    }
  });

  it('ignores entries with problems', () => {
    expect(buildWindows([{ ...conv('USD', '2025-01-07'), problem: { reasonCode: 'INVALID_AMOUNT', reason: 'x' } }])).toEqual([]);
  });
});
