# Israeli Business-Day and Payment-Terms (שוטף+N) Calculator

Use this tool as an **Israeli business days calculator**: add/subtract/count business days on the **Sunday–Thursday work week** (or **TASE trading days**, the exchange's own Monday–Friday calendar), check if a date is a business day, or run it as a **שוטף plus 60 payment terms calculator** (שוטף+N / net-eom+N) — all Israeli-holiday-aware, with Erev-chag half-days and configurable roll conventions, computed offline in bulk.

**What generic business-day calculators already do:** count/skip weekends and a public-holiday list (several exist on Apify). **What this adds:** the Israeli calendar specifically — Sunday–Thursday weeks, the nine statutory Israeli holidays (not a generic list), Erev-chag half-days, an unverified-but-dated Monday–Friday TASE-calendar switch, שוטף+N/net-eom+N parsing, roll conventions, and Hebrew-dated output.

## Who it's for

- Israeli accounts-payable/receivable, bookkeepers and fintech computing שוטף+N due dates in bulk.
- Logistics and shipping teams scheduling around the Sunday–Thursday work week and Israeli holidays.
- Developers and no-code automations (Sheets/Make/n8n) that need "is this a business day in Israel?" without hand-maintaining a holiday table.

## Input

Set the top-level fields for **one** calculation, or use `calculations` for **many** at once (each entry overrides only the top-level fields it sets — see the example below).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `calculations` | array of objects | no | Bulk mode: one object per calculation. Omit to run a single calculation from the fields below. |
| `operation` | string | no | `add` (default), `subtract`, `count-between`, `next`, `is-business-day`, `payment-due`. |
| `startDate` | string | no | ISO date (default `2026-09-10`); the invoice date for `payment-due`. |
| `days` | integer | no | Business days to add/subtract (default 3; negative reverses direction). |
| `endDate` | string | for `count-between` | ISO date. |
| `paymentTerms` | string | for `payment-due` | `"שוטף+N"` or `"net-eom+N"`, e.g. `"שוטף+60"`. |
| `calendarProfile` | string | no | `il-workweek-sun-thu` (default), `il-tase-mon-fri`, `iso-mon-fri`, `custom`. |
| `rollConvention` | string | no | `following` (default), `modified-following`, `preceding` — used by `payment-due` when the computed date is not a business day. |
| `customWeekendDays` | array of integers | for `calendarProfile=custom` | Weekday numbers, 0=Sunday..6=Saturday (default `[5,6]`). |
| `extraHolidays` | array of strings | no | ISO dates that are never business days (e.g. an ad-hoc election day). |
| `halfDaysAreBusiness` | boolean | no | Default `true`: Erev-chag afternoons (and, on the TASE profile, Friday) still count as business days. |

Example input:

```json
{
  "calculations": [
    { "operation": "add", "startDate": "2026-09-10", "days": 3 },
    { "operation": "payment-due", "startDate": "2026-01-15", "paymentTerms": "שוטף+60" }
  ]
}
```

This is close to the Actor's default input (the default omits `calculations` entirely and just uses the top-level fields, which is the same as passing `calculations: [{}]`) — it finishes in well under a second and needs no network.

## Output

One dataset row per calculation, in input order:

```json
{
  "input": "{}",
  "position": 1,
  "operation": "add",
  "status": "ok",
  "reasonCode": "OK",
  "reason": null,
  "result": "2026-09-16",
  "weekday": "Wednesday",
  "weekdayHe": "יום רביעי",
  "resultHebrewDate": "5 Tishrei 5787",
  "resultHebrewDateHe": "ה׳ בתשרי תשפ״ז",
  "isBusinessDay": null,
  "rolled": false,
  "rollReason": null,
  "rollReasonHe": null,
  "businessDaysCount": null,
  "holidaysInRange": [
    { "date": "2026-09-12", "name": "Rosh Hashana 5787", "nameHe": "ראש השנה 5787", "reason": "holiday" },
    { "date": "2026-09-13", "name": "Rosh Hashana II", "nameHe": "ראש השנה ב׳", "reason": "holiday" }
  ],
  "halfDay": null,
  "halfDayReason": null,
  "halfDayReasonHe": null,
  "assumptions": { "calendarProfile": "il-workweek-sun-thu", "rollConvention": "following", "halfDaysAreBusiness": true, "customWeekendDays": null, "extraHolidaysCount": 0 }
}
```

A malformed entry (bad `startDate`, missing `endDate`/`paymentTerms` for the operation that needs it) keeps `input`/`position`/`operation` with a `reasonCode` (`INVALID_START_DATE`, `INVALID_END_DATE`, `MISSING_END_DATE`, `MISSING_PAYMENT_TERMS`, `UNPARSEABLE_PAYMENT_TERMS`) and every other field `null` — it was never charged for, since nothing was computed. Besides the dataset, each run stores a `SUMMARY` record in the key-value store.

## Pricing

Pay per event: **$0.002 per calculation successfully computed** (event `calculation`; see `pricing.json`). A malformed entry is free. To cap your spend, set the run's **maximum total charge**.

## Limitations

- **VERIFY — the TASE Monday–Friday switch date is unverified.** `calendarProfile: "il-tase-mon-fri"` assumes TASE trading moved from Sunday–Thursday to Monday–Friday on **2026-01-05**, and that Friday's session ends early (half day) rather than being a full holiday. This was written from this repo's `research/TOP60.md` brief (2026-09-28), which itself was not fetched from tase.co.il or a Bank of Israel notice — this environment has no network access. The fact is isolated, dated and sourced in `src/lib/tase-profile.ts`; confirm it against a primary TASE source (and update `verifiedOn` there) before relying on this profile for real trading-day decisions. Every other date/logic in this Actor (the Sunday–Thursday work week, the nine statutory holidays, Erev-chag half-days, שוטף+N arithmetic) is deterministic calendar maths or comes directly from `@hebcal/core`.
- **The statutory holiday set is exactly nine days**: Rosh Hashanah (2 days), Yom Kippur, Sukkot I, Shemini Atzeret, Pesach I and VII, Shavuot, and Yom HaAtzma'ut. Purim, Chanukah, Tu BiShvat, minor fasts and **Chol HaMoed are ordinary business days** by default (Chol HaMoed is explicitly not a holiday here — TOP60.md 4.5 edge case). Shushan Purim (Jerusalem-only) is not treated as a holiday at all, so its Jerusalem-specific status never applies.
- **`rolled`/`rollReason` only apply to `payment-due`.** `add`/`subtract`/`next` always land on a business day by construction, so they are never rolled.
- **A holiday chain** (e.g. Rosh Hashanah adjoining a Shabbat, spanning 3–4 calendar days) is walked through correctly by `add`/`subtract`/`count-between`, and every holiday day it crosses appears in `holidaysInRange`.
- No timezone/clock handling: every date is a plain civil (calendar) date, matching how שוטף+N and business-day counting are actually used (an invoice date, not an instant). `extraHolidays` and `customWeekendDays` are the caller's own overrides and are not validated against any external calendar.
- This is a rules pre-check, not legal, tax or trading advice.

## Privacy and legal

Input is dates and calendar options — no personal data. All computation happens inside the run; no third-party API is called and nothing is sent anywhere. This Actor depends on `@hebcal/core` (GPL-2.0); see `LICENSES.md` for why that is compatible with this being a private hosted Actor.

## Support

Found a date that looks wrong, or the TASE switch date confirmed/changed? Please open an issue on the Actor's Issues tab with the calculation you ran and what you expected.
