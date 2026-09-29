/**
 * שוטף+N ("shotef+N") / net-eom+N payment-term parsing: N calendar days after the END of the
 * calendar month containing the invoice date, before any roll convention is applied.
 */
import { endOfGregorianMonthRd } from './civil.js';

export interface ParsedPaymentTerm {
  days: number;
  /** The form the input matched, for the assumptions echo. */
  form: 'shotef' | 'net-eom';
}

const SHOTEF_RE = /^שוטף\s*\+\s*(\d+)$/u;
const NET_EOM_RE = /^net-eom\s*\+\s*(\d+)$/iu;

/** Parse "שוטף+60" or "net-eom+30" (whitespace around the "+" is tolerated). Returns null for anything else - never throws. */
export function parsePaymentTerms(text: string): ParsedPaymentTerm | null {
  const t = text.trim();
  const he = SHOTEF_RE.exec(t);
  if (he) return { days: Number(he[1]), form: 'shotef' };
  const en = NET_EOM_RE.exec(t);
  if (en) return { days: Number(en[1]), form: 'net-eom' };
  return null;
}

/** R.D. of the (pre-roll) due date: end of the invoice date's Gregorian month, plus N calendar days. */
export function rawDueDateRd(invoiceRd: number, term: ParsedPaymentTerm): number {
  return endOfGregorianMonthRd(invoiceRd) + term.days;
}
