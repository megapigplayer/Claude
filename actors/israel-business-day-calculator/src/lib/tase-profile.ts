/**
 * TASE (Tel Aviv Stock Exchange) trading-week data. Kept as its own small, versioned module (rather
 * than hard-coded inline) so the unverified facts in it are easy to find, date and override -
 * CONVENTIONS.md "Data-driven rules": "Anything regulatory ... lives in a versioned JSON-shaped
 * structure with effectiveFrom, source and verifiedOn".
 *
 * VERIFY: written from this repo's TOP60.md research brief (2026-09-28), which itself was not
 * fetched from tase.co.il or a Bank of Israel notice (no network access in this environment).
 * Confirm both facts below against a primary TASE source before relying on this for real trading-day
 * decisions, and update `verifiedOn` once done.
 */
export interface DatedFact<T> {
  value: T;
  description: string;
  source: string;
  verifiedOn: string | null;
}

/** The Gregorian date TASE's trading week is understood to switch from Sunday-Thursday to Monday-Friday. */
export const TASE_MON_FRI_SWITCH: DatedFact<string> = {
  value: '2026-01-05',
  description: "TASE trading week switches from Sunday-Thursday to Monday-Friday on this date (inclusive).",
  source: 'TOP60.md research brief (2026-09-28), citing a planned TASE calendar change; not independently confirmed against tase.co.il or a Bank of Israel notice.',
  verifiedOn: null,
};

/** On the post-switch Monday-Friday calendar, Friday's session ends early rather than being a full holiday. */
export const TASE_FRIDAY_EARLY_CLOSE: DatedFact<string> = {
  value: '14:00',
  description: "Israel-time close of TASE's Friday session on the Monday-Friday calendar (modeled here as a half business day, not a holiday).",
  source: 'TOP60.md research brief (2026-09-28); not independently confirmed.',
  verifiedOn: null,
};
