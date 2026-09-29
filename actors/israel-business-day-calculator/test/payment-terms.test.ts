import { describe, expect, it } from 'vitest';
import { civilToRd, isoFromRd } from '../src/lib/civil.js';
import { parsePaymentTerms, rawDueDateRd } from '../src/lib/payment-terms.js';

describe('parsePaymentTerms', () => {
  it('parses שוטף+N (Hebrew)', () => {
    expect(parsePaymentTerms('שוטף+60')).toEqual({ days: 60, form: 'shotef' });
    expect(parsePaymentTerms('שוטף+30')).toEqual({ days: 30, form: 'shotef' });
  });

  it('tolerates whitespace around the +', () => {
    expect(parsePaymentTerms('שוטף + 60')).toEqual({ days: 60, form: 'shotef' });
  });

  it('parses net-eom+N (English), case-insensitively', () => {
    expect(parsePaymentTerms('net-eom+30')).toEqual({ days: 30, form: 'net-eom' });
    expect(parsePaymentTerms('NET-EOM+30')).toEqual({ days: 30, form: 'net-eom' });
  });

  it('returns null (never throws) for anything else', () => {
    for (const bad of ['', 'net-30', 'שוטף', 'eom+30', 'שוטף+', 'net-eom+']) expect(parsePaymentTerms(bad)).toBeNull();
  });
});

describe('rawDueDateRd: end of the invoice month + N days', () => {
  it('שוטף+30 from 2026-01-15 = end of January (31) + 30 days = 2026-03-02', () => {
    const rd = rawDueDateRd(civilToRd(2026, 1, 15), { days: 30, form: 'shotef' });
    expect(isoFromRd(rd)).toBe('2026-03-02');
  });

  it('שוטף+60 from the same invoice date = 2026-04-01', () => {
    const rd = rawDueDateRd(civilToRd(2026, 1, 15), { days: 60, form: 'shotef' });
    expect(isoFromRd(rd)).toBe('2026-04-01');
  });

  it('is independent of which day of the month the invoice date is (always keys off month-end)', () => {
    const a = rawDueDateRd(civilToRd(2026, 1, 1), { days: 10, form: 'shotef' });
    const b = rawDueDateRd(civilToRd(2026, 1, 31), { days: 10, form: 'shotef' });
    expect(a).toBe(b);
  });

  it('a February invoice uses February\'s real length (leap-year aware)', () => {
    const rd2028 = rawDueDateRd(civilToRd(2028, 2, 10), { days: 0, form: 'shotef' }); // 2028 is a leap year
    expect(isoFromRd(rd2028)).toBe('2028-02-29');
    const rd2026 = rawDueDateRd(civilToRd(2026, 2, 10), { days: 0, form: 'shotef' });
    expect(isoFromRd(rd2026)).toBe('2026-02-28');
  });
});
