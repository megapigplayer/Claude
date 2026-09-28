# apify-tools

A monorepo template for a portfolio of small, paid **Apify Actors** (pay-per-event pricing) that an AI agent builds and
maintains on a schedule. Every Actor is a TypeScript project with a thin Apify wrapper around pure, unit-tested logic, a
Store-quality README, and a quality gate that runs **offline**: no Apify account, token or network access is needed to build,
test and smoke-run an Actor.

| Path | Purpose |
| --- | --- |
| `actors/<name>/` | One self-contained Actor (`apify push` and `docker build` work from that folder alone) |
| `actors/iban-validator/` | Pilot Actor: bulk IBAN validation / normalization (ISO 13616 + mod-97), bank/branch extraction, BIC format check, one PPE event per IBAN |
| `templates/actor-ts/` | The template new Actors are copied from |
| `scripts/` | `new-actor`, `test-all`, `smoke-local`, `check-health` (plain Node, no dependencies) |
| `.github/workflows/` | `test.yml` (push/PR), `deploy.yml` (manual, needs `APIFY_TOKEN`), `health.yml` (nightly, needs `APIFY_TOKEN`) |
| `CONVENTIONS.md` | **Read this first**: verified SDK facts, the quality checklist every Actor must satisfy, what could not be verified |
| `research/` | Market research (not part of the build) |

## Requirements

Node.js 20+ (developed on 22) and npm 10. Docker and an Apify account are only needed to deploy.

## Quick start

```bash
npm install                                   # one install for every Actor (npm workspaces: actors/*)
node scripts/test-all.mjs --smoke             # conventions + schemas + build + typecheck + unit tests + local smoke run, summary table
node scripts/smoke-local.mjs iban-validator   # run one Actor locally on its prefill input and assert the output
```

## Add an Actor

```bash
node scripts/new-actor.mjs my-actor "My Actor Title"   # copies templates/actor-ts -> actors/my-actor
npm install                                            # links the new workspace
```

Then, in `actors/my-actor/`:

1. Put the logic in `src/lib/` as pure functions (no `apify` imports) and unit-test it in `test/`. Replace `src/lib/example.ts`.
2. Write `.actor/input_schema.json` with a **tiny, deterministic `prefill`** (Apify re-runs every public Actor on it daily) and mirror it in `src/lib/input.ts` (`DEFAULT_INPUT`; a test enforces equality).
3. Describe the output in `.actor/dataset_schema.json` (camelCase, must match the real rows), the price in `pricing.json`, the expected default-input result in `test/smoke.expect.json`, and write the Store `README.md`.
4. Keep `src/lib/ppe.ts` untouched except its `PPE_EVENTS` block (a check enforces this): it charges one event per result or per job, respects the caller's `maxTotalChargeUsd`, and never crashes locally without pay-per-event.
5. `node scripts/test-all.mjs --only my-actor --smoke` until green; measure cost with `node scripts/smoke-local.mjs my-actor --measure`.

The full checklist (legal basis, no login, no third-party personal data, tiny default input, low compute, price >= 5x measured
cost, README structure, input schema and output naming rules, error handling) is in [CONVENTIONS.md](CONVENTIONS.md).

## Test

| Command | What it checks |
| --- | --- |
| `node scripts/test-all.mjs` | For every Actor and the template: conventions (static), official Apify schema validation (offline), `tsc` build, typecheck of src + tests, Vitest unit tests |
| `node scripts/test-all.mjs --smoke` | + a local Apify-mode run per Actor on its prefill input: dataset non-empty, expected fields/rows, simulated pay-per-event charging, budget cap |
| `node scripts/test-all.mjs --standalone` | + copy each Actor out of the repo and `npm install` / build / test / smoke it alone (what Docker sees) |
| `node scripts/smoke-local.mjs <name> [--measure]` | One Actor; `--measure` prints wall time, peak RSS and an estimated cost per event vs. the price |
| `npm run test:scripts` | Unit tests of the scripts themselves (`node --test`) |

Local runs mirror the platform: storage lives in `storage/` (`CRAWLEE_STORAGE_DIR`; `APIFY_LOCAL_STORAGE_DIR` is ignored by
`apify@3`), input is `storage/key_value_stores/default/INPUT.json`, rows appear in `storage/datasets/default/`, and pay-per-event
is simulated with `ACTOR_TEST_PAY_PER_EVENT=true` (charges land in the local `charging_log` dataset). To use the official CLI
instead: `cd actors/<name> && npx apify run --input-file <file>`.

## Deploy and monitor

- **Deploy**: GitHub Actions > `deploy` > *Run workflow* > enter the Actor folder name. It re-runs the quality gate and then `apify push`. Without the `APIFY_TOKEN` repository secret it does nothing and ends green with a notice. Set the price in Apify Console > Publication > Monetization (`pricing.json` documents the intended events and prices; the Console is the source of truth).
- **Monitor**: the nightly `health` workflow reads each Actor's recent runs via the Apify API and fails loudly if one is unhealthy (2 of the last 3 finished runs failed = the platform's "under maintenance" threshold). Without the secret it exits 0 with a notice.

## Status of verification

Built and verified offline in a sandbox without Apify access: SDK behaviour (read from `apify@3.7.2` and exercised), all schemas
(official validators), build, 706 unit tests for the pilot (incl. differential tests against an independent IBAN library), local smoke runs incl. simulated charging, standalone installs.
**Not verified**: `apify push`, the Docker image build, Store/Console pricing, the health-check API calls, the GitHub workflows
on GitHub. The complete list is in [CONVENTIONS.md, section 7](CONVENTIONS.md#7-could-not-be-verified-read-before-trusting).
