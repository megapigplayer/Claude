/**
 * The currencies for which the Bank of Israel publishes a daily representative rate against the
 * shekel, with the quotation unit (how many units of the foreign currency one published rate
 * covers, e.g. JPY is quoted per 100).
 *
 * VERIFY(BOI-09): the list of 14 currencies below is written from memory of the BOI exchange-rate
 * page; confirm it against the live "representative rates" table before publishing (the BOI has
 * changed the list in the past).
 * VERIFY(BOI-08): the quotation units (JPY 100, LBP 10, every other currency 1) are from memory and
 * are a fallback only: whenever the source states a unit next to a rate, that value wins. A wrong
 * unit would be a x10 / x100 error in conversions, so confirm every unit against the live data.
 *
 * Independent cross-check (test/currencies.test.ts): every code must be a real ISO 4217 code known
 * to the runtime's ICU (`Intl.supportedValuesOf('currency')`), and every ICU English and Hebrew
 * currency name must resolve back to its code through `normalizeCurrency`.
 */

export interface BoiCurrency {
  code: string;
  name: string;
  /** Units of the foreign currency covered by one published rate (ILS per `unit` units). */
  unit: number;
}

export const BOI_CURRENCIES: readonly BoiCurrency[] = [
  { code: 'USD', name: 'US Dollar', unit: 1 },
  { code: 'GBP', name: 'British Pound', unit: 1 },
  { code: 'JPY', name: 'Japanese Yen', unit: 100 },
  { code: 'EUR', name: 'Euro', unit: 1 },
  { code: 'AUD', name: 'Australian Dollar', unit: 1 },
  { code: 'CAD', name: 'Canadian Dollar', unit: 1 },
  { code: 'DKK', name: 'Danish Krone', unit: 1 },
  { code: 'NOK', name: 'Norwegian Krone', unit: 1 },
  { code: 'ZAR', name: 'South African Rand', unit: 1 },
  { code: 'SEK', name: 'Swedish Krona', unit: 1 },
  { code: 'CHF', name: 'Swiss Franc', unit: 1 },
  { code: 'JOD', name: 'Jordanian Dinar', unit: 1 },
  { code: 'LBP', name: 'Lebanese Pound', unit: 10 },
  { code: 'EGP', name: 'Egyptian Pound', unit: 1 },
];

export const SUPPORTED_CODES: readonly string[] = BOI_CURRENCIES.map((c) => c.code);

const BY_CODE = new Map(BOI_CURRENCIES.map((c) => [c.code, c]));

export function getCurrency(code: string): BoiCurrency | undefined {
  return BY_CODE.get(code);
}

/** Extra names people type. Bare "krone"/"krona"/"dollar" variants that are ambiguous are left out on purpose. */
const ALIASES: Record<string, readonly string[]> = {
  USD: ['$', 'US$', 'DOLLAR', 'DOLLARS', 'USD DOLLAR', 'דולר', 'דולר ארהב', 'דולר אמריקני', 'דולר אמריקאי'],
  EUR: ['€', 'EURO', 'EUROS', 'אירו', 'יורו'],
  GBP: ['£', 'POUND', 'POUNDS', 'POUND STERLING', 'STERLING', 'לירה שטרלינג', 'פאונד', 'פאונד שטרלינג'],
  JPY: ['¥', 'YEN', 'ין', 'ין יפני', 'יין'],
  CHF: ['FRANC', 'SWISS FRANC', 'פרנק', 'פרנק שוויצרי', 'פרנק שווייצרי', 'פרנק שוויצי'],
  ZAR: ['RAND', 'ראנד'],
  JOD: ['DINAR', 'דינר', 'דינר ירדני'],
  AUD: ['דולר אוסטרלי'],
  CAD: ['דולר קנדי'],
  DKK: ['כתר דני'],
  NOK: ['כתר נורווגי', 'כתר נורבגי'],
  SEK: ['כתר שוודי', 'כתר שבדי'],
  LBP: ['לירה לבנונית'],
  EGP: ['לירה מצרית'],
};

/** Upper-case, drop quotes/dots/hyphens and collapse spaces, so "ארה\"ב", "u.s. dollar" and "US  Dollar" compare equal. */
function keyOf(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/["'`׳״‘’“”.\-_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function icuNames(locale: string): Array<[string, string]> {
  try {
    const names = new Intl.DisplayNames([locale], { type: 'currency' });
    const out: Array<[string, string]> = [];
    for (const { code } of BOI_CURRENCIES) {
      const name = names.of(code);
      if (name && name !== code) out.push([code, name]);
    }
    return out;
  } catch {
    return []; // runtime without full ICU: codes and the static aliases still work
  }
}

const LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const { code, name } of BOI_CURRENCIES) {
    map.set(keyOf(code), code);
    map.set(keyOf(name), code);
  }
  for (const [code, list] of Object.entries(ALIASES)) for (const alias of list) map.set(keyOf(alias), code);
  for (const locale of ['en', 'he']) for (const [code, name] of icuNames(locale)) map.set(keyOf(name), code);
  return map;
})();

export type CurrencyParse = { ok: true; code: string } | { ok: false; reason: string };

/** Map what the caller typed (code, symbol, English or Hebrew name) to a supported ISO code. */
export function normalizeCurrency(raw: unknown): CurrencyParse {
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: false, reason: 'the currency is empty' };
  const code = LOOKUP.get(keyOf(raw));
  if (code) return { ok: true, code };
  const upper = keyOf(raw);
  if (upper === 'ILS' || upper === 'NIS' || upper === '₪' || upper === 'שקל' || upper === 'שקלים' || upper === 'שח') {
    return { ok: false, reason: 'ILS (the shekel) is the target currency of every rate; there is no ILS/ILS rate to look up' };
  }
  return {
    ok: false,
    reason: `"${raw.trim()}" is not one of the ${BOI_CURRENCIES.length} currencies the Bank of Israel publishes a representative rate for (${SUPPORTED_CODES.join(', ')})`,
  };
}
