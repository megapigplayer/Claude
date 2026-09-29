# Jewish Holidays Calendar API (Hebcal-style)

Use this tool to generate the full Jewish/Hebrew calendar (**Hebrew calendar JSON**) for any year: chagim, fasts, Rosh Chodesh, Omer, parasha and Hebrew dates, computed entirely offline with the Israel or diaspora schedule, as JSON, CSV or iCal (.ics) for synagogues and community apps. This is a **Jewish holidays API** / **Israel public holidays** calendar with no rate limits and no daily quota — one call returns a whole year.

## Who it's for

- Scheduling, HR/payroll and logistics developers who need "is this a holiday?" or a full year of dates without hand-maintaining a table (or getting leap-year/Adar maths wrong).
- E-commerce and delivery back-offices that need to know when to show "closed for the holiday."
- Synagogue, community and Jewish-education software that needs **Rosh Chodesh, Omer, parasha** and holiday dates as structured data or an importable calendar file.
- AI agents and MCP tool users: Hebrew-calendar leap years, Adar I/II and the Israel/diaspora split are exactly the kind of maths large language models get wrong.

## Input

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `year` | integer | no (defaults to 2026) | Gregorian year (or Hebrew year, if `yearType` is `"hebrew"`). |
| `yearType` | string | no | `gregorian` (default) or `hebrew`. |
| `location` | string | no | `israel` (default) or `diaspora`. |
| `include` | array of strings | no | Categories to return: `major`, `minor`, `fasts`, `roshChodesh`, `modern`, `omer`, `parasha`, `specialShabbat`. Default `["major","fasts"]`. |
| `language` | string | no | `en`, `he` or `both` (default). |
| `format` | string | no | `json` (default), `csv` or `ics` — the dataset is always JSON; `csv`/`ics` additionally writes a file to the key-value store. |

Example input:

```json
{
  "year": 2026,
  "yearType": "gregorian",
  "location": "israel",
  "include": ["major", "fasts"],
  "language": "both",
  "format": "json"
}
```

This is also the Actor's default input (used for the daily automated health check): it finishes in well under a second and needs no network.

## Output

One dataset row per matching holiday/event, sorted by date, plus one trailing summary ("meta") row:

```json
{
  "rowType": "holiday",
  "date": "2026-09-12",
  "hebrewDate": "1 Tishrei 5787",
  "hebrewDateHe": "א׳ בתשרי תשפ״ז",
  "name": "Rosh Hashana 5787",
  "nameHe": "ראש השנה 5787",
  "category": "major",
  "beginsEveningBefore": true,
  "isYomTov": true,
  "isIsraeliPublicHoliday": true,
  "memo": null,
  "hebrewYear": 5787,
  "isLeapYear": true,
  "hebrewYearsInRange": null
}
```

The meta row (`rowType: "meta"`) carries `hebrewYearsInRange`: every distinct Hebrew year the requested Gregorian year touches (normally two — a Gregorian year spans the tail of one Hebrew year and the start of the next), each with `isLeapYear` and `yearLength` (days in that Hebrew year):

```json
{
  "rowType": "meta",
  "date": null,
  "hebrewDate": null,
  "hebrewDateHe": null,
  "name": "Year summary",
  "nameHe": null,
  "category": null,
  "beginsEveningBefore": null,
  "isYomTov": null,
  "isIsraeliPublicHoliday": null,
  "memo": "Gregorian year 2026, location=israel, include=major,fasts.",
  "hebrewYear": null,
  "isLeapYear": null,
  "hebrewYearsInRange": [
    { "hebrewYear": 5786, "isLeapYear": false, "yearLength": 355 },
    { "hebrewYear": 5787, "isLeapYear": true, "yearLength": 385 }
  ]
}
```

`isIsraeliPublicHoliday` marks the nine statutory Israeli public-holiday days (Rosh Hashana x2, Yom Kippur, Sukkot I, Shemini Atzeret, Pesach I and VII, Shavuot, Yom HaAtzma'ut) and is only set (non-`null`) when `location` is `"israel"`. With `format: "csv"` or `format: "ics"`, the run's key-value store also holds a record named `OUTPUT` in that format (find its URL from the run's **Key-value store** tab).

## Pricing

Pay per event: **$0.01 per run** (event `calendar-year`; see `pricing.json`) — one charge for the whole year + location + category selection, however many rows it produces. To cap your spend, set the run's **maximum total charge**; if it is already at zero when the run starts, nothing is computed and nothing is charged.

## Limitations

- **Holiday dates and the Israel/diaspora split come from `@hebcal/core`** (see "Privacy and legal" for its licence); the Gregorian↔Hebrew date maths, gematria formatting and the statutory-holiday table are this Actor's own code.
- **`isYomTov` / `beginsEveningBefore` are this Actor's own definitions**, not a field `@hebcal/core` exposes directly: `isYomTov` is true for a work-restricted festival day (including Yom Kippur); `beginsEveningBefore` is true for every Yom Tov and every major fast (Yom Kippur, Tisha B'Av) — both begin at sunset the evening before the listed date. Minor fasts begin at dawn, not the evening before.
- **`memo` explains a Shabbat-deferred fast date** (e.g. Ta'anit Esther moved to Thursday) for the five fixed-date fasts; it does not explain *why* a modern holiday (Yom HaZikaron, Yom HaAtzma'ut, Yom HaShoah) fell on a particular weekday — only its final, correct date is given.
- **Default `include` is `["major","fasts"]` only.** Well-known days like Chanukah, Purim and Tu BiShvat are category `"minor"` and are not returned unless you add it to `include`.
- Not a substitute for consulting a rabbi or a local community calendar for practical observance questions.
- No network calls; nothing here is verified against hebcal.com over the network (this environment has none). Cross-checked instead against the specific anchor dates in this repo's `research/TOP60.md` and against independent oracles in the test suite.

## Privacy and legal

Input is a year number and a handful of options — no personal data. All computation happens inside the run; no third-party API is called and nothing is sent anywhere. This Actor depends on `@hebcal/core` (GPL-2.0); see `LICENSES.md` for why that is compatible with this being a private hosted Actor.

## Support

Found a date that looks wrong? Please open an issue on the Actor's Issues tab with the year, location and the date you expected — a concrete example is the fastest way to get it fixed.
