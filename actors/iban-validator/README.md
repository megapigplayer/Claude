# IBAN Validator & Normalizer

Check IBANs in bulk, offline and in seconds. For every IBAN you get a clear **valid / invalid verdict with a reason**, the
**normalized and print-formatted IBAN**, the **country**, and - where the country's format defines them - the **bank code,
branch code and account number**. Optionally add a BIC/SWIFT code to each IBAN and get a **BIC format check** too.

The check is a pure algorithm (ISO 13616 structure + ISO 7064 MOD 97-10 checksum). It calls **no bank API and no third-party
service**, needs **no login or API key**, and your IBANs never leave the run.

## Who it's for

- Finance and accounting teams cleaning supplier, payroll or customer files **before** a SEPA batch or wire, so payments don't bounce.
- E-commerce and marketplace back offices validating payout details collected from sellers.
- Data and integration engineers who need a fast bulk step in a pipeline (API, Make, Zapier, n8n, Google Sheets, scheduled runs).
- Anyone with a messy list ("de89 3704 0044 0532 0130 00", "IBAN: DE89-3704-...") who needs it normalized.

## What you get for each IBAN

- `valid` plus a machine-readable `reasonCode` and a human-readable `reason`, so you know *why* an IBAN failed (wrong length, typo caught by the checksum, forbidden character, unknown country, wrong national format).
- The IBAN in **electronic format** (`iban`) and in **print format** (`ibanFormatted`, groups of four).
- `countryCode`, `countryName`, `checkDigits` and the `bban`.
- `bankCode`, `branchCode` and `accountNumber` for the countries whose format defines them (see the table below).
- If you supply a BIC: `bic`, `bicValid` and `bicReason` (ISO 9362 format check).

Tolerated in the input: spaces, non-breaking spaces, hyphens, lower case, a leading "IBAN" label. Anything else (dots, underscores, letters like "Ü") is reported as `INVALID_CHARACTERS`.

## Input

Provide IBANs as a list, as CSV text, or both. The list comes first in the output.

| Field | Type | Description |
| --- | --- | --- |
| `ibans` | array of strings | One IBAN per entry. Add a BIC as `"IBAN,BIC"` (delimiters `,` `;` `\|` or tab). |
| `csvText` | string | CSV text. With a header row containing `iban` (and optionally `bic` / `swift`) those columns are used and all other columns are ignored. Without a header: column 1 = IBAN, column 2 = BIC. Comma, semicolon, tab or pipe delimited; quotes and quoted line breaks are supported. |
| `maxItems` | integer | Safety cap (default 10 000, maximum 100 000): only the first N IBANs are validated and billed. |

Blank entries and CSV rows without an IBAN are skipped: they are not validated and not billed.

Example input:

```json
{
  "ibans": [
    "GB82 WEST 1234 5698 7654 32",
    "DE89370400440532013000",
    "NL91ABNA0417164300,ABNANL2A",
    "DE89370400440532013001"
  ],
  "csvText": "customer_id,iban,bic\n1001,FR1420041010050500013M02606,\n1002,NOTANIBAN,",
  "maxItems": 10000
}
```

This Actor's default input (used for the daily automated check) is a small set of six IBANs, so a run with the default input finishes in a few seconds.

## Output

One dataset item per IBAN, in input order (`source` and `position` let you join results back to your file). Export as JSON, CSV, Excel or via the API.

```json
{
  "input": "GB82 WEST 1234 5698 7654 32",
  "source": "ibans",
  "position": 1,
  "valid": true,
  "reasonCode": "OK",
  "reason": "Valid IBAN: length, national format and check digits are correct.",
  "iban": "GB82WEST12345698765432",
  "ibanFormatted": "GB82 WEST 1234 5698 7654 32",
  "countryCode": "GB",
  "countryName": "United Kingdom",
  "checkDigits": "82",
  "bban": "WEST12345698765432",
  "bankCode": "WEST",
  "branchCode": "123456",
  "accountNumber": "98765432",
  "bic": null,
  "bicValid": null,
  "bicReason": null
}
```

An invalid IBAN keeps the diagnostic fields but never reports formatted or extracted values as if they were trustworthy:

```json
{
  "input": "DE89370400440532013001",
  "source": "ibans",
  "position": 4,
  "valid": false,
  "reasonCode": "BAD_CHECKSUM",
  "reason": "The check digits do not match the rest of the IBAN (ISO 7064 MOD 97-10 remainder is 28, expected 1); a digit is probably mistyped.",
  "iban": "DE89370400440532013001",
  "ibanFormatted": null,
  "countryCode": "DE",
  "countryName": "Germany",
  "checkDigits": null,
  "bban": null,
  "bankCode": null,
  "branchCode": null,
  "accountNumber": null,
  "bic": null,
  "bicValid": null,
  "bicReason": null
}
```

`valid` describes the IBAN only; a bad BIC does not turn a valid IBAN invalid (check `bicValid` separately). Besides the dataset, each run stores a `SUMMARY` record in the key-value store with the counts (valid, invalid, by reason and by country).

### Reason codes

| `reasonCode` | Meaning |
| --- | --- |
| `OK` | Length, national format and check digits are correct. |
| `EMPTY` | Nothing left after removing spaces and separators. |
| `INVALID_CHARACTERS` | Contains something other than letters A-Z, digits 0-9, spaces or hyphens. |
| `BAD_PREFIX` | Does not start with a 2-letter country code followed by 2 digits. |
| `UNKNOWN_COUNTRY` | The country code is not in the supported list below. |
| `WRONG_LENGTH` | The length does not match the country (the message says what to expect). |
| `BAD_BBAN_FORMAT` | The account part has letters where the country requires digits (or the reverse). |
| `BAD_CHECKSUM` | The MOD 97-10 check failed - typically a mistyped or transposed digit. |
| `INTERNAL_ERROR` | Unexpected problem with this one entry; the rest of the run is unaffected. |

## Pricing

Pay per event: **$0.002 per IBAN checked** (event `iban-validated`, one dataset row = one event, whether the verdict is valid or invalid).
Blank entries are free. To cap your spend, set the run's **maximum total charge** - the Actor stops cleanly at that limit and tells you how many entries were not checked.
Platform usage for these tiny runs is negligible (256 MB, a few seconds).

## Limitations

- **ISO 13616 checks only.** A valid result means the IBAN has a known country prefix, the right length for that country, the national character layout, and correct MOD 97-10 check digits. It does **not** prove that the account exists, is open, or belongs to a particular person.
- **National check digits inside the account number are not verified.** Some countries add their own check digits to the BBAN (for example Spain, France/Monaco, Belgium, Poland, Portugal, Czechia, Slovakia). An independent library that verifies them rejects random, format-valid IBANs of these countries: BA, BE, BY, CZ, EE, ES, FR, HR, HU, MC, ME, MK, NO, PK, PL, PT, RS, SI, SK. This Actor accepts such IBANs if the ISO check passes, so for these countries a "valid" IBAN can still be rejected by its bank.
- **BIC is a format check.** It verifies the ISO 9362 shape (4 letters, 2 letters, 2 characters, optional 3 characters); it does not look the code up in the SWIFT directory or verify that the country letters are assigned.
- **Country list.** 85 countries and territories with an IBAN prefix are supported (table below). Countries added to the SWIFT registry after this list was written are reported as `UNKNOWN_COUNTRY`. French overseas territories and the Aland Islands use the `FR` / `FI` prefix, and "experimental" non-registry codes are not supported. The lengths and layouts were written offline from the registry as known to the author, and are cross-checked in the test suite against one published example per country and against an independently maintained IBAN library; they have **not** been diffed against the current SWIFT registry document - please report any mismatch.
- **Bank / branch / account extraction** is available for 59 countries (marked below) and follows the national layout (for example Germany = 8-digit bank code, United Kingdom = 4-letter bank code + 6-digit sort code). For the others only length, layout and checksum are checked and the three fields stay `null`.
- Duplicates are not merged: every entry produces a row (and one billed event).
- The CSV reader is deliberately simple: one IBAN per row; without a header row, columns beyond the BIC are not interpreted.

### Supported countries

| Code | Country | IBAN length | Extraction |
| --- | --- | --- | --- |
| AD | Andorra | 24 | bank + branch + account |
| AE | United Arab Emirates | 23 | bank + account |
| AL | Albania | 28 | bank + branch + account |
| AT | Austria | 20 | bank + account |
| AZ | Azerbaijan | 28 | bank + account |
| BA | Bosnia and Herzegovina | 20 | bank + branch + account |
| BE | Belgium | 16 | bank + account |
| BG | Bulgaria | 22 | bank + branch + account |
| BH | Bahrain | 22 | bank + account |
| BR | Brazil | 29 | format check only |
| BY | Belarus | 28 | bank + branch + account |
| CH | Switzerland | 21 | bank + account |
| CR | Costa Rica | 22 | format check only |
| CY | Cyprus | 28 | bank + branch + account |
| CZ | Czechia | 24 | bank + account |
| DE | Germany | 22 | bank + account |
| DK | Denmark | 18 | bank + account |
| DO | Dominican Republic | 28 | format check only |
| EE | Estonia | 20 | bank + branch + account |
| EG | Egypt | 29 | format check only |
| ES | Spain | 24 | bank + branch + account |
| FI | Finland | 18 | bank + account |
| FO | Faroe Islands | 18 | bank + account |
| FR | France | 27 | bank + branch + account |
| GB | United Kingdom | 22 | bank + branch + account |
| GE | Georgia | 22 | bank + account |
| GI | Gibraltar | 23 | bank + account |
| GL | Greenland | 18 | bank + account |
| GR | Greece | 27 | bank + branch + account |
| GT | Guatemala | 28 | format check only |
| HR | Croatia | 21 | bank + account |
| HU | Hungary | 28 | bank + branch + account |
| IE | Ireland | 22 | bank + branch + account |
| IL | Israel | 23 | bank + branch + account |
| IQ | Iraq | 23 | format check only |
| IS | Iceland | 26 | bank + branch + account |
| IT | Italy | 27 | bank + branch + account |
| JO | Jordan | 30 | bank + branch + account |
| KW | Kuwait | 30 | bank + account |
| KZ | Kazakhstan | 20 | bank + account |
| LB | Lebanon | 28 | bank + account |
| LC | Saint Lucia | 32 | format check only |
| LI | Liechtenstein | 21 | bank + account |
| LT | Lithuania | 20 | bank + account |
| LU | Luxembourg | 20 | bank + account |
| LV | Latvia | 21 | bank + account |
| LY | Libya | 25 | format check only |
| MC | Monaco | 27 | bank + branch + account |
| MD | Moldova | 24 | format check only |
| ME | Montenegro | 22 | bank + account |
| MK | North Macedonia | 19 | bank + account |
| MN | Mongolia | 20 | format check only |
| MR | Mauritania | 27 | format check only |
| MT | Malta | 31 | bank + branch + account |
| MU | Mauritius | 30 | format check only |
| NI | Nicaragua | 28 | format check only |
| NL | Netherlands | 18 | bank + account |
| NO | Norway | 15 | bank + account |
| OM | Oman | 23 | format check only |
| PK | Pakistan | 24 | bank + account |
| PL | Poland | 28 | bank + branch + account |
| PS | Palestine, State of | 29 | format check only |
| PT | Portugal | 25 | bank + branch + account |
| QA | Qatar | 29 | bank + account |
| RO | Romania | 24 | bank + account |
| RS | Serbia | 22 | bank + account |
| RU | Russia | 33 | format check only |
| SA | Saudi Arabia | 24 | bank + account |
| SC | Seychelles | 31 | format check only |
| SD | Sudan | 18 | format check only |
| SE | Sweden | 24 | bank + account |
| SI | Slovenia | 19 | bank + branch + account |
| SK | Slovakia | 24 | bank + account |
| SM | San Marino | 27 | bank + branch + account |
| SO | Somalia | 23 | format check only |
| ST | Sao Tome and Principe | 25 | format check only |
| SV | El Salvador | 28 | format check only |
| TL | Timor-Leste | 23 | format check only |
| TN | Tunisia | 24 | format check only |
| TR | Turkey | 26 | bank + account |
| UA | Ukraine | 29 | bank + account |
| VA | Vatican City State | 22 | format check only |
| VG | Virgin Islands, British | 24 | format check only |
| XK | Kosovo | 20 | bank + branch + account |
| YE | Yemen | 30 | format check only |

## Privacy and legal

IBANs can be personal data. This Actor processes them only inside your run: no third-party API is called, no data is sent anywhere, and results are stored only in your own Apify dataset (subject to your storage retention settings). You are responsible for having a lawful basis to process the account data you submit.

## Support

Found an IBAN that is validated wrongly, or a country that is missing? Please open an issue on the Actor's Issues tab with the (anonymized) example.
