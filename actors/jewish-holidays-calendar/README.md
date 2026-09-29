# Jewish Holidays Calendar API (Hebcal-style)

> Replace every section below with real content before publishing. This is the
> structure every Actor in this monorepo should follow for its Store listing —
> see the parent repo's `CONVENTIONS.md` for the full checklist.

One or two sentences: what does this Actor do, concretely?

## Who it's for

Who has this problem, and why would they pay per event instead of doing it
themselves?

## Input

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `items` | array of strings | yes | The list of things to process. |
| `maxItems` | integer | no | Safety cap on how many items are processed in one run (default 1000). |

Example input:

```json
{
  "items": ["example-1", "example-2"],
  "maxItems": 1000
}
```

See `.actor/input_schema.json` for the authoritative schema (the same prefill
values above are what the Apify platform re-runs once a day as a health check —
keep them tiny and deterministic).

## Output

One dataset item per input item:

```json
{
  "input": "example-1",
  "ok": true,
  "value": "EXAMPLE-1",
  "error": null
}
```

## Pricing

Pay-per-event: charged once per processed item (event `task-completed`, see
`pricing.json` and `src/lib/ppe.ts`). Items skipped because the run hit your
`maxTotalChargeUsd` limit are neither produced nor charged.

## Limitations

- Describe known edge cases, unsupported input shapes, and anything that
  silently gets skipped rather than erroring.

## Support

Open an issue in this repository, or contact the maintainer via the Apify
Store page.
