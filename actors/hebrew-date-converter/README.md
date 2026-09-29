# Hebrew Date Converter API (Gregorian, sunset-aware)

Use this tool to bulk-convert dates between the Gregorian and Hebrew (Jewish) calendars — **Gregorian to Hebrew date** and **Hebrew to Gregorian date**, both directions, hundreds at a time. Every result includes the Hebrew date in English and in Hebrew letters (gematria, e.g. **תאריך עברי** י״ז בתשרי תשפ״ז), the day of the week, sunset-aware rollover, and (optionally) the Jewish holiday or weekly Torah portion (parasha) on that day. An "anniversary" mode also computes future Hebrew birthdays and **yahrzeit** dates, correctly handling leap-year Adar and short Cheshvan/Kislev.

## Who it's for

- No-code automators (Google Sheets, Make, n8n, Zapier) who have a column of dates and need the Hebrew equivalent, or vice versa, without a manual lookup per row.
- Synagogue, community, genealogy and Jewish-education software that stores or displays Hebrew dates (b'nei mitzvah, yahrzeit reminders).
- CRM, legal and HR systems that record a Hebrew-calendar event date and need it normalized to ISO Gregorian for sorting and search.
- AI agents and MCP tool users: Hebrew-calendar arithmetic (leap years, 30 Cheshvan/Kislev, Adar I/II) is exactly the kind of maths large language models get wrong; this Actor computes it deterministically, offline.

## Input

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `dates` | array of strings/objects | no (demo dates if omitted) | One date per entry: ISO (`2026-09-12`), English Hebrew (`17 Tishrei 5787`), Hebrew letters (`י״ז בתשרי תשפ״ז`), or an object `{"day":17,"month":"Tishrei","year":5787}`. |
| `direction` | string | no | `auto` (default), `g2h` (Gregorian only) or `h2g` (Hebrew only). |
| `afterSunset` | boolean | no | Default `false`. Roll a Gregorian entry's Hebrew day forward one day (the Hebrew day already began the evening before). |
| `language` | string | no | `en`, `he` or `both` (default). Which language fields to fill. |
| `mode` | string | no | `convert` (default) or `anniversary`. |
| `anniversaryType` | string | no | `birthday` (default) or `yahrzeit`, used when `mode` is `anniversary`. |
| `anniversaryYears` | integer | no | How many future anniversaries to list (default 5, max 100). |
| `anniversaryFrom` | string | no | ISO date; skip anniversaries before it (e.g. to resume a reminder list). |
| `adarRule` | string | no | `default` (Reingold-Dershowitz), `adar-i` or `adar-ii` — which Adar a leap year uses for an anniversary originally set in the single Adar of a regular year. |
| `schedule` | string | no | `israel` (default) or `diaspora` — affects one-day vs two-day holiday/parasha tags. |
| `addTags` | boolean | no | Default `true`. Add the `holiday`/`parasha` fields. |
| `maxItems` | integer | no | Safety cap, default 10,000, max 100,000. |

Example input:

```json
{
  "dates": ["2026-09-12", "2026-09-28"],
  "direction": "auto",
  "language": "both",
  "mode": "convert",
  "schedule": "israel",
  "addTags": true
}
```

This is also the Actor's default input (used for the daily automated health check): it finishes in well under a second and needs no network.

## Output

One dataset item per non-blank entry, in input order (`position` lets you join results back to your file):

```json
{
  "input": "2026-09-12",
  "position": 1,
  "status": "ok",
  "reasonCode": "OK",
  "reason": null,
  "direction": "g2h",
  "gregorian": "2026-09-12",
  "weekday": "Saturday",
  "weekdayHe": "שבת",
  "afterSunset": false,
  "hebrewDayGregorian": "2026-09-12",
  "beginsAtSunsetOn": "2026-09-11",
  "hebrewDay": 1,
  "hebrewMonth": "Tishrei",
  "hebrewMonthHe": "תשרי",
  "hebrewMonthNumber": 7,
  "hebrewMonthOfYear": 1,
  "hebrewYear": 5787,
  "hebrewString": "1 Tishrei 5787",
  "hebrewStringHe": "א׳ בתשרי תשפ״ז",
  "isLeapYear": true,
  "holidaySchedule": "israel",
  "holiday": "Rosh Hashana 5787",
  "holidayHe": "ראש השנה 5787",
  "parasha": null,
  "parashaHe": null,
  "anniversaryType": null,
  "anniversaries": null,
  "ruleNote": null
}
```

An entry that could not be converted keeps `input`/`position` and a machine-readable `reasonCode` (e.g. `INVALID_DATE`, `AMBIGUOUS_ADAR`, `AMBIGUOUS_DATE_FORMAT`, `UNKNOWN_MONTH`, `TIME_NOT_SUPPORTED`) with every other field `null`; blank entries are skipped entirely (not returned, not charged). Besides the dataset, each run stores a `SUMMARY` record in the key-value store (counts by direction and by reason code).

## Pricing

Pay per event: **$0.002 per date successfully converted** (event `date-converted`; see `pricing.json`). Blank entries and entries that could not be parsed are free. To cap your spend, set the run's **maximum total charge** — the Actor stops cleanly at that limit and reports how many entries were not processed. Platform usage for typical runs is negligible (256 MB, well under a second per few hundred dates).

## Limitations

- **Not a religious authority.** `holiday`/`parasha` tags and anniversary rules follow the standard Hebrew calendar and the Reingold-Dershowitz birthday/yahrzeit rules; communities differ on some points (which leap-year Adar, exact fast-day observance). Where a rule is configurable (`adarRule`) it is; otherwise the README and output say so — consult your rabbi for anything halachically consequential.
- **Ambiguous numeric dates are rejected, not guessed.** `12/09/2026` could be day/month/year or month/day/year; use ISO (`2026-09-12`) or a named-month format instead.
- **A bare "Adar" in a leap-year Hebrew date is rejected** (`AMBIGUOUS_ADAR`): a leap year has Adar I and Adar II, so the caller must say which one.
- **No clock times.** A Gregorian entry with a time other than midnight is rejected (`TIME_NOT_SUPPORTED`); use `afterSunset: true` (or per-entry `{"date": "...", "afterSunset": true}`) for an event after sundown instead of a clock time — the Actor does not do timezone/sunset-time lookups.
- **Supported range:** Gregorian year 1 to 6000 (proleptic Gregorian throughout, matching ISO 8601 and `Date`; no Julian calendar before 1582).
- Hebrew-calendar conversion, holiday names and parasha lookup come from `@hebcal/core` (see "Privacy and legal" for its licence); the Gregorian round trip and gematria formatting are this Actor's own code, cross-checked in tests against three independent implementations (Node's built-in `Intl` Hebrew calendar, `jewish-date`, `kosher-zmanim`) across the years 1900-2100 and beyond.

## Privacy and legal

Input is a list of dates; no personal data is required (`dates` do not have to represent a real person). All computation happens inside the run — no third-party API is called and nothing is sent anywhere. This Actor depends on `@hebcal/core` (GPL-2.0); see `LICENSES.md` for why that is compatible with this being a private hosted Actor.

## Support

Found a date that converts incorrectly? Please open an issue on the Actor's Issues tab with the input you used and what you expected — Hebrew-calendar edge cases (leap years, 30 Cheshvan/Kislev, Adar I/II) are exactly what the test suite is built to catch, so a concrete example is the fastest way to get it fixed.
