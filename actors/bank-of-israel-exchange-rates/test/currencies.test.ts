import { describe, expect, it } from 'vitest';
import { BOI_CURRENCIES, getCurrency, normalizeCurrency, SUPPORTED_CODES } from '../src/lib/currencies.js';

describe('the BOI currency table (independent oracle: the runtime ICU)', () => {
  it('lists 14 distinct currencies', () => {
    expect(BOI_CURRENCIES).toHaveLength(14);
    expect(new Set(SUPPORTED_CODES).size).toBe(14);
  });

  it('every code is a real ISO 4217 code known to ICU', () => {
    const known = new Set(Intl.supportedValuesOf('currency'));
    for (const code of SUPPORTED_CODES) expect(known.has(code), code).toBe(true);
  });

  it('our English names agree with the ICU names', () => {
    const icu = new Intl.DisplayNames(['en'], { type: 'currency' });
    for (const { code, name } of BOI_CURRENCIES) {
      // ICU wording can differ slightly between versions ("British Pound" vs "Pound Sterling"), so compare the last word.
      const last = (s: string): string => s.trim().split(/\s+/).at(-1)?.toLowerCase() ?? '';
      expect(last(icu.of(code) ?? ''), code).toBe(last(name));
    }
  });

  it('quotation units: JPY per 100 and LBP per 10, everything else per 1 (VERIFY(BOI-08))', () => {
    expect(getCurrency('JPY')?.unit).toBe(100);
    expect(getCurrency('LBP')?.unit).toBe(10);
    for (const c of BOI_CURRENCIES.filter((x) => x.code !== 'JPY' && x.code !== 'LBP')) expect(c.unit, c.code).toBe(1);
  });
});

describe('normalizeCurrency', () => {
  it('accepts codes in any case with surrounding spaces', () => {
    expect(normalizeCurrency('USD')).toEqual({ ok: true, code: 'USD' });
    expect(normalizeCurrency(' usd ')).toEqual({ ok: true, code: 'USD' });
    expect(normalizeCurrency('Eur')).toEqual({ ok: true, code: 'EUR' });
  });

  it('accepts symbols and common English and Hebrew names', () => {
    const cases: Array<[string, string]> = [
      ['$', 'USD'], ['€', 'EUR'], ['£', 'GBP'], ['¥', 'JPY'], ['dollar', 'USD'], ['US Dollar', 'USD'], ['euro', 'EUR'],
      ['דולר', 'USD'], ['אירו', 'EUR'], ['יורו', 'EUR'], ['ין', 'JPY'], ['פרנק שוויצרי', 'CHF'], ['לירה שטרלינג', 'GBP'], ['ראנד', 'ZAR'],
      ['Swiss Franc', 'CHF'], ['japanese yen', 'JPY'],
    ];
    for (const [text, code] of cases) expect(normalizeCurrency(text), text).toEqual({ ok: true, code });
  });

  it('resolves every ICU English and Hebrew currency name back to its code', () => {
    for (const locale of ['en', 'he']) {
      const names = new Intl.DisplayNames([locale], { type: 'currency' });
      for (const { code } of BOI_CURRENCIES) {
        const name = names.of(code);
        expect(name && normalizeCurrency(name), `${locale}:${code}:${name}`).toEqual({ ok: true, code });
      }
    }
  });

  it('rejects unknown, empty and non-string values with a helpful reason', () => {
    const cnh = normalizeCurrency('CNH');
    expect(cnh.ok).toBe(false);
    if (!cnh.ok) expect(cnh.reason).toMatch(/14 currencies/);
    for (const bad of ['', '  ', 'XXX', 'BTC', 'krone', 'USDD']) expect(normalizeCurrency(bad).ok, bad).toBe(false);
    expect(normalizeCurrency(undefined).ok).toBe(false);
    expect(normalizeCurrency(5).ok).toBe(false);
    expect(normalizeCurrency(null).ok).toBe(false);
  });

  it('explains that ILS itself has no rate', () => {
    for (const ils of ['ILS', 'nis', '₪', 'שקל']) {
      const r = normalizeCurrency(ils);
      expect(r.ok, ils).toBe(false);
      if (!r.ok) expect(r.reason, ils).toMatch(/target currency/);
    }
  });
});
