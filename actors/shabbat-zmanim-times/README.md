# Shabbat Candle-Lighting and Zmanim Times

Use this tool as a **Shabbat times API** / **zmanim API**: bulk **candle lighting times by city** (**זמני שבת**), havdalah, the weekly parasha and the full halachic-times (zmanim) block, for any built-in city or exact coordinates, one week or up to 52 weeks at once — no rate limits, no per-city lookup. Everything is computed offline (NOAA solar algorithm via `@hebcal/core`), so results are deterministic and instant.

## Who it's for

- Kosher hospitality and delivery/logistics teams that need "no deliveries after candle-lighting" scheduling, for one city or a whole chain of locations, weeks ahead.
- Synagogue and community-app developers who need a year's worth of weekly times without hand-computing sunset/havdalah.
- Israeli and Jewish scheduling SaaS and no-code automations (Sheets/Make/n8n) that need this every week, automatically.
- AI agents and MCP tool users: this is exactly the kind of astronomical + halachic-rule maths large language models get wrong.

## Input

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `locations` | array of strings/objects | no (demo cities if omitted) | A built-in city name (`"Jerusalem"`, `"Tel Aviv"`, `"New York"`, ...) or `{"latitude":..,"longitude":..,"tzid":"..","elevation":0,"israel":false,"name":"..."}`. |
| `startDate` | string | no | ISO date of the first week's Friday (default `2026-10-09`). A non-Friday rolls forward to the next Friday. |
| `weeks` | integer | no | 1-52 consecutive weeks per location (default 1). |
| `include` | array of strings | no | `shabbat` (candle lighting/havdalah/parasha), `zmanim` (the detailed times block), `holidays`. Default `["shabbat"]`. |
| `candleLightingMinutes` | integer | no | Override the location's default candle-lighting offset. |
| `havdalahMinutes` | integer | no | Fixed minutes after sunset for havdalah (overrides `havdalahDeg`). |
| `havdalahDeg` | number | no | Degrees of solar depression for havdalah when `havdalahMinutes` is unset (default 8.5 = 3 small stars). |

Example input:

```json
{
  "locations": ["Jerusalem", "Tel Aviv", "New York"],
  "startDate": "2026-10-09",
  "weeks": 1,
  "include": ["shabbat"]
}
```

This is also the Actor's default input (used for the daily automated health check): it finishes in well under a second and needs no network. Built-in city names (~65; case-insensitive) include Jerusalem, Tel Aviv, Haifa, Beer Sheva, Eilat, Tiberias, Petach Tikvah, New York, Los Angeles, Chicago, Boston, Miami, Toronto, Montreal, Vancouver, London, Paris, Berlin, Moscow, Sydney, Melbourne, Johannesburg, Buenos Aires, Mexico City, Sao Paulo and more — see `Location.lookup()` in `@hebcal/core` for the full list, or supply exact coordinates for anywhere else.

## Output

One dataset row per (location, week), in input order:

```json
{
  "input": "Jerusalem",
  "position": 1,
  "week": 1,
  "status": "ok",
  "reasonCode": "OK",
  "reason": null,
  "location": { "name": "Jerusalem", "latitude": 31.76904, "longitude": 35.21633, "tzid": "Asia/Jerusalem", "elevation": 786, "israel": true },
  "friday": "2026-10-09",
  "fridayRolledForward": false,
  "candleLighting": "2026-10-09T17:34:00+03:00",
  "havdalah": "2026-10-10T18:49:00+03:00",
  "parasha": "Bereshit",
  "parashaHe": "בראשית",
  "holiday": null,
  "holidayHe": null,
  "zmanim": null,
  "warnings": null
}
```

`candleLighting`, `havdalah` and every field inside `zmanim` are ISO 8601 timestamps **with the location's real UTC offset** (not converted to UTC) — the point of a candle-lighting time is the local wall-clock moment to act on, and an offset timestamp is still unambiguous. A location that could not be resolved (unknown city name, bad coordinates) keeps `input`/`position`/`week` with a `reasonCode` (`UNKNOWN_CITY`, `BAD_LATITUDE`, `BAD_LONGITUDE`, `BAD_TZID`, `BAD_ELEVATION`) and every other field `null`; blank entries are skipped entirely. Besides the dataset, each run stores a `SUMMARY` record in the key-value store.

## Pricing

Pay per event: **$0.01 per (location, week) successfully computed** (event `location-week`; see `pricing.json`). A location this Actor could not resolve is free, for every week it would have covered. To cap your spend, set the run's **maximum total charge**: each location's full set of weeks is treated as one all-or-nothing unit, so the run stops cleanly before starting a location it could not fully pay for (never partially computed, never unpaid work).

## Limitations

- **Location data and holiday/candle-lighting rules come from `@hebcal/core`** (see "Privacy and legal" for its licence); this includes the standard candle-lighting default (18 minutes in the diaspora, 20 minutes elsewhere in Israel, 40 in Jerusalem, 30 in Haifa and Zikhron Ya'akov) and the NOAA-based sunrise/sunset used throughout.
- **No live geocoding.** City names resolve only against `@hebcal/core`'s ~65 built-in "classic" cities (TOP60.md 4.4: a full GeoNames search needs a database file this offline build does not have); anywhere else needs exact `latitude`/`longitude`/`tzid`.
- **Degree-based zmanim can be null even on a day with a normal sunrise/sunset.** `alotHaShachar`, `sofZmanShmaMga` and `tzeit` estimate a fixed amount of light in the sky; at higher latitudes near midsummer (e.g. London in July) the sun may never reach the needed depression angle even though it does rise and set — this is a real astronomical limit, not a bug, and is covered by a test.
- **No sunrise/sunset at all** (polar day/night) returns `null` for `candleLighting`, `havdalah` and every `zmanim` field, with a note in `warnings` — never a guess.
- **Elevation** is always used (each built-in city's real elevation; 0 for a custom location unless you set `elevation`), consistently for both the displayed zmanim and the candle-lighting/havdalah calculation.
- A Shabbat immediately before/after a multi-day festival (e.g. Rosh Hashana, or Shemini Atzeret/Simchat Torah in the diaspora) is handled: `havdalah` can fall a day or two after Friday, and `holiday` lists every holiday in that span.
- `parasha` is the weekly Torah-portion reading; it is `null` on a week whose Shabbat reading is a festival portion instead (e.g. Shabbat coincides with Shemini Atzeret).

## Privacy and legal

Input is a list of place names/coordinates and date options — no personal data. All computation happens inside the run; no third-party API is called and nothing is sent anywhere. This Actor depends on `@hebcal/core` (GPL-2.0) and, transitively, `@hebcal/noaa` (LGPL-2.1); see `LICENSES.md` for why that is compatible with this being a private hosted Actor.

## Support

Found a time that looks wrong? Please open an issue on the Actor's Issues tab with the location, date and what you expected (and, if halachically relevant, which opinion/custom you follow) — a concrete example is the fastest way to get it fixed.
