/**
 * Israeli bank numbers (the number inside an Israeli IBAN is "0" + the two-digit bank number, e.g. Bank Leumi =
 * 10 -> IBAN bank code "010").
 *
 * VERIFY: this is a SMALL static table, NOT the complete Bank of Israel / Masav participant list, and it is
 * not authoritative. `status` records how much each row was checked on 2026-09-29 (research environment has
 * no access to boi.org.il / masav.co.il; page fetches are blocked, only web-search snippets were readable):
 *   - 'secondary': the code appeared in search snippets of independent Israeli sources (bank-number guides,
 *                  accounting firms) that name the bank.
 *   - 'memory'   : written from the author's memory; the code was only confirmed to EXIST in the snippets,
 *                  or not at all. Treat as unverified.
 * Codes that are not in the table give bankName = null (never a guess). Refresh from the Bank of Israel list
 * (https://www.boi.org.il, "bank numbers") or Masav's participants list when network access exists.
 */
export interface BankInfo {
  en: string;
  he: string;
  status: 'secondary' | 'memory';
}

/** Key: two-digit bank number. */
export const BANKS: Readonly<Record<string, BankInfo>> = {
  '04': { en: 'Bank Yahav for Government Employees', he: 'בנק יהב לעובדי המדינה', status: 'secondary' },
  '09': { en: 'Postal Bank (Bank Hadoar)', he: 'בנק הדואר', status: 'secondary' },
  '10': { en: 'Bank Leumi', he: 'בנק לאומי לישראל', status: 'secondary' },
  '11': { en: 'Israel Discount Bank', he: 'בנק דיסקונט לישראל', status: 'secondary' },
  '12': { en: 'Bank Hapoalim', he: 'בנק הפועלים', status: 'secondary' },
  '13': { en: 'Bank Igud', he: 'בנק אגוד לישראל', status: 'secondary' },
  '14': { en: 'Bank Otsar Hahayal', he: 'בנק אוצר החייל', status: 'secondary' },
  '17': { en: 'Mercantile Discount Bank', he: 'בנק מרכנתיל דיסקונט', status: 'secondary' },
  '20': { en: 'Mizrahi-Tefahot Bank', he: 'בנק מזרחי טפחות', status: 'secondary' },
  '22': { en: 'Citibank N.A.', he: 'סיטיבנק', status: 'memory' },
  '23': { en: 'HSBC Bank', he: 'HSBC', status: 'memory' },
  '26': { en: 'UBank', he: 'יובנק', status: 'memory' },
  '31': { en: 'First International Bank of Israel', he: 'הבנק הבינלאומי הראשון לישראל', status: 'secondary' },
  '34': { en: 'Arab Israel Bank', he: 'הבנק הערבי הישראלי', status: 'secondary' },
  '39': { en: 'State Bank of India', he: 'סטייט בנק אוף אינדיה', status: 'secondary' },
  '46': { en: 'Bank Massad', he: 'בנק מסד', status: 'secondary' },
  '52': { en: 'Bank Poalei Agudat Israel', he: 'בנק פועלי אגודת ישראל', status: 'secondary' },
  '54': { en: 'Bank of Jerusalem', he: 'בנק ירושלים', status: 'memory' },
  '99': { en: 'Bank of Israel', he: 'בנק ישראל', status: 'memory' },
};

export interface BankLookup {
  /** The 3-digit code as it appears in the IBAN, e.g. "010". */
  bankCode: string;
  /** The two-digit bank number ("10"), or the 3-digit code itself when it does not start with 0. */
  bankNumber: string;
  bankName: string | null;
  bankNameHe: string | null;
}

/** Looks up the 3-digit IBAN bank code ("010" -> Bank Leumi). Unknown codes give null names. */
export function lookupBank(ibanBankCode: string): BankLookup {
  const bankNumber = ibanBankCode.startsWith('0') ? ibanBankCode.slice(1) : ibanBankCode;
  const info = BANKS[bankNumber];
  return { bankCode: ibanBankCode, bankNumber, bankName: info?.en ?? null, bankNameHe: info?.he ?? null };
}
