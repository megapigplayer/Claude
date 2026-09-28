# Conventions

Rules for every Actor in this monorepo. They exist because (1) each public Apify Actor is re-run daily on its
default/prefill input and **fails 2 of the last 3 runs => "under maintenance"** (rule as stated in the project brief; not
verifiable offline), (2) Actors are monetised with pay-per-event (PPE), so a wrong charge or a silent data gap costs money
and trust, and (3) an AI agent maintains them on a schedule, so anything that can be checked mechanically is checked by
`node scripts/test-all.mjs --smoke` instead of relying on memory.

Verification status is marked throughout: **[verified]** = read from the installed packages or executed in this repo,
**[unverified]** = not checkable offline (no Apify account, no network access to apify.com, no Docker daemon).

## 1. Verified SDK facts

Everything here was read from **`apify@3.7.2`** (latest v3 on npm, installed 2026-09-28; paths relative to
`node_modules/apify/dist/`) and **`apify-cli@1.10.0`**, then exercised locally.

### Lifecycle, input, output

| Fact | Exact signature / behaviour | Source |
| --- | --- | --- |
| Init | `static init(options?: InitOptions): Promise<void>`; `InitOptions = { storage?, gracefulShutdown?: boolean, gracefulShutdownDelayMillis?: number }`. Also initialises the charging manager. | `actor.d.ts:931`, `:14`; `actor.js:282` |
| Exit | `static exit(messageOrOptions?: string \| ExitOptions, options?: ExitOptions): Promise<void>`; `ExitOptions = { statusMessage?, timeoutSecs? (30), exitCode? (0), exit? (true) }`. By default it **calls `process.exit`** after cleanup, so code after `await Actor.exit()` does not run. | `actor.d.ts:937`, `:29`; `actor.js:299-300` |
| Fail | `static fail(messageOrOptions?, options?): Promise<void>` = `exit` with `exitCode: 1`. | `actor.d.ts:943` |
| Main (legacy wrapper) | `static main<T>(userFunc: UserFunc<T>, options?: MainOptions): Promise<T>`; `MainOptions = ExitOptions & InitOptions`. This repo uses the explicit `init()` / `exit()` / `fail()` pattern instead. | `actor.d.ts:902`, `:42` |
| Input | `static getInput<T = Dictionary \| string \| Buffer>(): Promise<T \| null>` (null if no INPUT record); `getInputOrThrow<T>()` throws when missing. Input key is `INPUT`. | `actor.d.ts:1230`, `:1235`; `configuration.js:210` |
| Push (plain) | `static pushData<Data extends Dictionary>(item: Data \| Data[]): Promise<void>` | `actor.d.ts:1101` |
| Push + charge | `static pushData<Data extends Dictionary>(item: Data \| Data[], eventName: string): Promise<ChargeResult>` - "will attempt to charge for the event for each pushed item". Requires `Actor.init()` (`_ensureActorInit`); **throws for names starting with `apify-`** ("Cannot charge for synthetic event ... manually"). | `actor.d.ts:1126`; `actor.js:666-668` |
| KV store | `static setValue<T>(key, value: T \| null, options?): Promise<void>`, `getValue<T>(key): Promise<T \| null>` | `actor.d.ts:1202`, `:1171` |
| Platform detection | `static isAtHome(): boolean` = `!!process.env.APIFY_IS_AT_HOME` | `actor.d.ts:1351`; `actor.js:1040-1041`; `configuration.js:141` |
| Logging | `import { log } from 'apify'`; `log.info / warning / error / debug`, plus `log.warningOnce(message)` | `@apify/log/cjs/index.d.ts:217-234` |

### Pay-per-event API

| Fact | Exact signature / behaviour | Source |
| --- | --- | --- |
| Charge | `static charge(options: ChargeOptions): Promise<ChargeResult>`; `ChargeOptions = { eventName: string; count?: number /* 1 */ }` | `actor.d.ts:1327`; `charging.d.ts:4` |
| Result | `ChargeResult = { eventChargeLimitReached: boolean; chargedCount: number; chargeableWithinLimit: Record<string, number> }`. `chargedCount` may be **less than requested** when `maxTotalChargeUsd` would be exceeded. | `charging.d.ts:16-45` |
| Manager | `static getChargingManager(): ChargingManager` with `getPricingInfo(): ActorPricingInfo` (`{ pricingModel?, maxTotalChargeUsd, isPayPerEvent, perEventPrices }`), `charge(...)`, `getChargedEventCount(eventName): number`, `getMaxTotalChargeUsd(): number`, `calculateMaxEventChargeCountWithinLimit(eventName): number` (Infinity when unpriced/unlimited) | `actor.d.ts:1331`; `charging.d.ts:46-113` |
| Not PPE => no crash | If the run is not pay-per-event (local run, no token, unmonetised), `charge()` logs one warning ("Ignored attempt to charge ...") and resolves `{ chargedCount: 0, eventChargeLimitReached: false, ... }`. It never throws for that reason. | `charging.js:241-253` |
| Budget | `maxTotalChargeUsd` comes from env `ACTOR_MAX_TOTAL_CHARGE_USD` (locally) or the run option (platform); `0`/unset => `Infinity`. The SDK enforces it: rows beyond the budget are **dropped** by `pushData(items, eventName)`, and when the caller keeps charging past the limit it "overcharges by one event so the platform terminates the run". | `configuration.js:170`; `charging.js:109`, `:264` (overcharge by one), `:378-414` (`calculatePushDataLimits`: keeps only the rows that fit), `:429` (`pushDataAndCharge`) |
| Synthetic event | `DEFAULT_DATASET_ITEM_EVENT = "apify-default-dataset-item"` - charged automatically by the platform for default-dataset writes if (and only if) the Actor's pricing defines it; `apify-*` events are tracked locally only and cannot be charged manually. Defining it **and** a custom event bills both. | `charging.d.ts:3`; `charging.js:292`; `patched_apify_client.js:58` |
| Local PPE simulation | `ACTOR_TEST_PAY_PER_EVENT=true` makes a local run behave as PPE at a flat **$1 per event**; `ACTOR_USE_CHARGING_LOG_DATASET=true` writes every charge to the local dataset `charging_log`. Both throw if `APIFY_IS_AT_HOME` is set. Observed: one log entry per `pushData` call with `chargedCount` = rows saved; a cap of `ACTOR_MAX_TOTAL_CHARGE_USD=2` saves exactly 2 rows. | `configuration.js:171-172`; `charging.js:35`, `:153-157`, `:280`, `:365`; smoke run |

`chargedCount` returned by `pushData` is **not** the number of saved rows on the platform (it can also sum the synthetic
event), so `src/lib/ppe.ts` derives `pushedCount` from `getChargedEventCount()` before/after.

### Local run

| Fact | Detail | Source |
| --- | --- | --- |
| Storage dir env var | The SDK reads **`CRAWLEE_STORAGE_DIR`** (default `./storage`, or `./crawlee_storage` if that exists). **`APIFY_LOCAL_STORAGE_DIR` appears only in doc comments and is ignored by v3** - [verified experimentally: with only that variable set, output landed in `./storage`]. `apify run` sets both. | `@crawlee/memory-storage/memory-storage.js:86`; `@crawlee/core/storages/dataset.js:96-101` (doc comment); apify-cli bundle |
| Layout | Input: `<dir>/key_value_stores/default/INPUT.json`. Rows: `<dir>/datasets/default/000000001.json, ...`. PPE log: `<dir>/datasets/charging_log/`. | `key_value_store.js:68`; smoke runs |
| `apify run` | "Executes Actor locally with simulated Apify environment variables. Stores data in local 'storage' directory." Flags: `-i/--input <json>`, `--input-file <path>`, `-p/--purge`, `--resurrect`, `--entrypoint`. It needs no login. This repo's smoke script does the same thing without the CLI (`scripts/lib/smoke.mjs`). | `apify run --help` (apify-cli 1.10.0) |
| Schema validation | `apify validate-schema` validates input, dataset, output and KV-store schemas **offline** [verified: accepts good, rejects broken schemas]. `.actor/actor.json` itself is validated with the official JSON schema from the `@apify/json_schemas` npm package (no network). The official actor.json schema has **no pricing/monetisation field**: PPE prices are set in the Apify Console. | `apify validate-schema --help`; `@apify/json_schemas@0.16.19` |
| Deploy | `apify push [actorId] [--dir <dir>] [-w <secs>] [-b <tag>] [-f] [--json]`; token from env `APIFY_TOKEN` ("Please set it using the environment variable APIFY_TOKEN or apify login command"); files matched by `.gitignore` / `.actorignore` are not uploaded. **[unverified]** end-to-end: never run without an account. | `apify push --help`; apify-cli bundle |

## 2. Repository layout

```
actors/<name>/             one self-contained Actor (apify push / docker build work from this folder alone)
  .actor/actor.json  input_schema.json  dataset_schema.json
  Dockerfile  .dockerignore  .actorignore  package.json  tsconfig.json  tsconfig.test.json
  src/main.ts              THIN Apify wrapper: init, input, batch loop, push+charge, exit
  src/lib/*.ts             pure logic, NO apify imports (except ppe.ts) - unit tested
  src/lib/ppe.ts           charging helper, COPIED from the template (never imported across folders)
  test/*.test.ts  test/fixtures/  test/smoke.expect.json
  pricing.json             repo-local pricing plan (Apify does not read it; see 4.3)
  README.md                the Store listing
templates/actor-ts/        the template `scripts/new-actor.mjs` copies
scripts/                   new-actor, test-all, smoke-local, check-health (+ lib/, test/)
.github/workflows/         test.yml, deploy.yml, health.yml
```

`actors/*` is an npm workspace: one root `npm install`, one root `package-lock.json`. Every Actor still lists **all its own
dependencies** and never uses `file:`/`workspace:` specifiers, so the Docker build (context = the Actor folder only) works;
`node scripts/test-all.mjs --standalone` copies each Actor out of the repo and proves it.

Dependency pins: `typescript ^5.9.3` and `vitest ^3.2.7` on purpose. npm's `latest` tags were TypeScript 7.x and Vitest 5.x
when this was written; a template that 60 Actors inherit should not be built on majors nobody has exercised yet. Bump
deliberately, in the template first.

## 3. Adding and shipping an Actor

1. `node scripts/new-actor.mjs my-actor "My Actor Title"` then `npm install`.
2. Put the logic in `src/lib/` (pure, tested), keep `src/main.ts` thin. Replace `example.ts`.
3. Write `.actor/input_schema.json` (tiny `prefill`), mirror it in `src/lib/input.ts` `DEFAULT_INPUT`, fill
   `dataset_schema.json`, `pricing.json`, `README.md`, `test/smoke.expect.json`.
4. `node scripts/test-all.mjs --only my-actor --smoke` must be green (also `--standalone` before the first deploy).
5. Measure cost: `node scripts/smoke-local.mjs my-actor --measure` (plus one large-batch run), put the numbers into `pricing.json`.
6. Deploy with the `deploy` workflow (needs the `APIFY_TOKEN` secret), set the price in Console > Publication > Monetization.

## 4. Quality checklist (definition of done)

Mechanical items are enforced by `scripts/lib/check-actor.mjs` / `test-all.mjs`; the rest are review items for the author
(human or agent). Every box must be ticked before an Actor is published.

### 4.1 Legal and data

- [ ] **Legal basis is written down** in the Actor's README ("Privacy and legal"): the data is user-supplied, public-domain/open-licensed, or the source's terms/robots.txt permit automated access. If you cannot state it in one sentence, do not build it.
- [ ] **No login, no credentials.** Nothing behind authentication, paywalls, CAPTCHAs or anti-bot circumvention; no user-provided passwords or cookies.
- [ ] **No third-party personal data.** Do not collect or store people's data from sources. User-supplied personal data (like IBANs) is processed only inside the run, never sent to third parties, and the README says so.
- [ ] No secrets in the repo; `APIFY_TOKEN` exists only as a GitHub secret. Never log input values that may be sensitive at INFO level beyond what is needed.

### 4.2 Tiny, deterministic, cheap

- [ ] **Tiny default input.** `prefill` has at most 20 list items / 2000 JSON chars (checked). It runs in seconds, needs **no network** if at all possible, and gives the **same output every day**. (The platform runs this input daily; a flaky default = "under maintenance".)
- [ ] The Actor must succeed when started with **no input, `{}`, or only schema defaults** (`normalizeInput` falls back to `DEFAULT_INPUT`). It must **fail with a clear `InputError`** when the caller's own work-defining field is present but unusable (never run the demo for a paying user whose list was empty).
- [ ] **Low compute:** 256 MB (`defaultMemoryMbytes` in actor.json), plain HTTP + parsing, no headless browser unless there is no alternative, batches for storage writes (`BATCH_SIZE`), a `maxItems` cap in the schema.
- [ ] `smoke-local` finishes far below the platform's 2-minute test budget (the script enforces 110 s).

### 4.3 Pricing (pay-per-event)

- [ ] **Price >= 5x measured cost.** `pricing.json` lists every charged event with `priceUsd`, `estimatedCostUsd` (measured compute + any paid API, per event, **worst case = the smallest run**) and `costBasis`. `test-all` fails if `priceUsd < 5 x estimatedCostUsd`. Measure with `node scripts/smoke-local.mjs <name> --measure` (wall time, peak RSS, cost at `SMOKE_CU_USD`, default **$0.40 per compute unit - an unverified, deliberately conservative assumption**; set your plan's real price) and repeat with a large `--input`. Include paid third-party API/proxy cost per event.
- [ ] Event names are kebab-case, defined once in `PPE_EVENTS` (`src/lib/ppe.ts`), declared in `pricing.json` (checked both ways), and entered in the Console. **Never** use names starting `apify-`.
- [ ] **One event per result** (`pushResultsAndCharge`) **or one per job** (`chargeEvent`), not both for the same work. Charge only for rows actually saved. Define **either** the synthetic `apify-default-dataset-item` event **or** a custom event, never both.
- [ ] Failed items: decide and document whether they are charged. Default in this repo: a row that could be *processed* (even with verdict "invalid") is charged; blank/skipped input and rows lost to an internal failure are not.
- [ ] Respect the caller's limit: size each batch with `remainingChargeable(event)` and stop early with a clear status message. Never do work that will not be paid for.
- [ ] `src/lib/ppe.ts` is byte-identical to the template apart from the `PPE_EVENTS` block (keep it that way; improve the template first).

### 4.4 README (Store listing) structure

`README.md` must contain, in this order: `# Title` with a one-paragraph promise; `## Who it's for`; `## Input` (table +
JSON example that the test suite parses); `## Output` (JSON example whose keys equal the real output - tested);
`## Pricing` (event, price, what is free, how to cap spend); `## Limitations` (what a green result does **not** prove,
coverage gaps, data freshness); `## Privacy and legal`; `## Support`. No marketing claims the tests do not back.

### 4.5 Input schema conventions

- Property names **camelCase**; every property has `title`, `type`, `description`; list inputs use `editor: "stringList"`, long text `textarea`.
- Work-defining fields carry `prefill` (Console form + daily test) and **no `default`** (the platform would inject it into API runs that only meant to set other fields) and are **not `required`** when the code has a demo fallback. If a field is `required` it must have a prefill/default (checked).
- `maxItems` (integer, `minimum`, `maximum`, `default`) on every Actor that loops.
- `DEFAULT_INPUT` in `src/lib/input.ts` equals the schema prefill/default; a unit test enforces it.
- Validate in code as well: return readable `InputError` messages, coerce leniently (numbers to strings), clamp `maxItems`.
- Schemas must pass `apify validate-schema` (run by `test-all`).

### 4.6 Error handling: one bad item never fails the run

- Pure functions return a result object for *expected* bad input (`valid: false, reasonCode, reason`); they never throw for it.
- The batch loop still wraps each item (`safeBuildRow`-style) so an unexpected exception becomes one `INTERNAL_ERROR` row, not a failed run.
- Network sources: per-item timeout and bounded retries; a failing item yields an error row (`status`/`error` fields), not an exception.
- Fail the whole run (`Actor.fail`, exit code 1) only for: invalid caller input, or an infrastructure failure where results could not be saved (never return less data silently). Never exit 0 with an empty dataset because of an internal error.
- `PPE` helper functions never throw; they return `{ ok: false, ... }`.

### 4.7 Output field naming

- **camelCase** keys, stable across versions (renaming = breaking change = new major in the README changelog).
- Echo the caller's input value in `input` (plus `source` / `position` when there are several sources) so results can be joined back.
- Real booleans and `null` (never `""` or `"N/A"`); ISO 8601 UTC for timestamps; ISO country codes; numbers as numbers.
- Machine-readable `reasonCode` (UPPER_SNAKE) **and** human-readable `reason`.
- Do not present unvalidated details as if trustworthy (invalid IBAN => no `bankCode`).
- `dataset_schema.json` properties, the overview view, `smoke.expect.json` and the README example must match the real row keys (the pilot has tests for all four).

### 4.8 Tests

- Unit tests cover the pure library thoroughly (valid and invalid samples, edge cases, fuzz for "never throws"), with fixtures in `test/fixtures/`; no network, no clock/randomness without a seed.
- **Data written from memory needs an independent oracle.** If an Actor embeds reference data (country tables, code lists, rate tables), cross-check it in tests against a second, independently maintained source (an exact-pinned devDependency or a published fixture) and document every disagreement, as `actors/iban-validator/test/oracle.test.ts` does. Prefer the more permissive reading when sources disagree, so real input is never rejected.
- `test/smoke.expect.json` states the expected default-input result (`requiredFields`, `expectedItems`, `rows`, `charge`, `budgetCap`); `smoke-local` verifies it in plain, simulated-PPE and budget-cap runs.
- `npm run typecheck` type-checks `src` **and** `test` (Vitest itself does not).

## 5. Scripts

| Command | What it does |
| --- | --- |
| `node scripts/new-actor.mjs <name> "<Title>"` | Copy `templates/actor-ts` to `actors/<name>` and fill `__ACTOR_NAME__` / `__ACTOR_TITLE__` |
| `node scripts/test-all.mjs [--smoke] [--standalone] [--only a,b] [--skip-install] [--jobs N]` | Root install, conventions check, official schema validation, build, typecheck, unit tests, optional smoke and standalone runs; summary table; exit 1 on any failure |
| `node scripts/smoke-local.mjs <name> [--measure] [--no-ppe] [--input file] [--memory-mb N]` / `--all` | Offline local-mode run on the prefill input; asserts non-empty dataset, fields, rows, simulated charging, budget cap |
| `node scripts/check-health.mjs [--strict]` | Nightly run-status check via the Apify API (needs `APIFY_TOKEN`; inert without it) |
| `npm run test:scripts` | `node:test` tests of the scripts themselves |

## 6. CI/CD

- `.github/workflows/test.yml` - every push/PR: `node scripts/test-all.mjs --smoke` (manual run can add `--standalone`).
- `.github/workflows/deploy.yml` - `workflow_dispatch` with `actor` input; validates the name, re-runs the quality gate for that Actor, then `apify push`. Without the `APIFY_TOKEN` secret every step after the gate is skipped and the job ends green with a notice.
- `.github/workflows/health.yml` - nightly `check-health.mjs`; no token => notice and exit 0; a failing/`under maintenance`-risk Actor => `::error` annotations and exit 1. GitHub disables scheduled workflows after 60 days of repository inactivity.

## 7. Could NOT be verified (read before trusting)

1. **Anything on the Apify platform**: `apify push`, Docker image build (no Docker daemon in the sandbox; the `apify/actor-node:22` tag and the multi-stage Dockerfile follow the documented pattern but were never built), Store publication, real PPE charging, Console pricing UI.
2. **The daily-test semantics** (uses `prefill`, `default` or both; what counts as a failure) and the "2 of last 3 => under maintenance" rule are taken from the brief. The code is written to survive all variants: prefill present, no `default` on work-defining fields, demo fallback for `{}`.
3. **`scripts/check-health.mjs` endpoints** (`GET /v2/users/me`, `GET /v2/acts/<user>~<name>/runs?desc=1&limit=5`, run status names incl. `TIMED-OUT`) are from memory of the Apify API docs; `api.apify.com` answers 403 through the sandbox proxy. Only the logic is tested (fixtures).
4. **GitHub workflows** were only parsed as YAML; the `actions/*@v4` versions are from memory. The scripts they call were run locally.
5. **Compute-unit price** ($0.40 assumed) and platform overhead (container start, storage API latency) - cost numbers are local estimates.
6. **SWIFT IBAN Registry data** in `actors/iban-validator/src/lib/countries.ts` was written from memory offline; it could not be diffed against the current registry document. It **is** cross-checked in `test/iban.test.ts` (one published example IBAN per country passes the real mod-97 checksum and agrees with the table) and in `test/oracle.test.ts` against an independently maintained library (`ibantools@4.5.4`, exact-pinned devDependency): all 85 lengths are identical, BBAN character layouts are identical except two documented more-permissive cases, and bank/branch positions agree wherever both label them (3 documented exceptions). That differential check found 6 missing countries (MN, NI, OM, RU, SO, YE, now added) and 7 layout/label differences (FI, IS, XK role labels corrected; GE, IE, PK, TR character classes loosened to the more permissive reading). Not verified: registry changes after ibantools 4.5.4 (2026-04), and role labels for countries where ibantools defines no identifier. National BBAN check digits (19 countries, listed in the Actor README) are deliberately not verified.
7. BIC support is a **format** check (ISO 9362 shape), not a directory lookup.

### Dependency licences

- Prefer MIT/BSD/Apache-2.0/ISC dependencies.
- GPL/LGPL dependencies (e.g. `@hebcal/core`, GPL-2.0) are allowed **only** because our Actors run as a private hosted service: the code and Docker image are never distributed to users. Consequences: this repository must stay private, such Actors must never be published as open-source Actors, and the dependency's licence must be listed in the Actor's `pricing.json` notes or a `LICENSES.md` in the Actor folder. AGPL dependencies are **not** allowed (network use triggers copyleft).
- Dev-only test oracles (devDependencies used only in tests) may have any OSI licence.
