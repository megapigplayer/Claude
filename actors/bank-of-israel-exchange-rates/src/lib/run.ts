/**
 * The whole answering pipeline without any Apify call (pure apart from the injected source):
 * input -> plan -> source requests -> rows. main.ts wraps it with dataset pushes and charging; the
 * end-to-end tests run it against the fixture-backed source.
 */
import type { RateSource } from './boi-adapter.js';
import type { ActorInput, DataSourceChoice } from './input.js';
import { type LoadResult, loadSeries } from './load.js';
import { buildPlan, type Plan } from './plan.js';
import { buildRows, type ResultRow, type RowContext } from './process.js';

export interface PreparedRun {
  plan: Plan;
  loaded: LoadResult;
  context: RowContext;
}

export async function prepareRun(input: ActorInput, now: Date, source: RateSource, dataSource: DataSourceChoice): Promise<PreparedRun> {
  const plan = buildPlan(input, now);
  const loaded = await loadSeries(plan.windows, source, { today: plan.today });
  const context: RowContext = {
    rule: plan.rateRule,
    now,
    today: plan.today,
    dataSource,
    series: loaded.seriesByCurrency,
    failures: loaded.failures,
    stats: { skippedNoPublication: 0 },
  };
  return { plan, loaded, context };
}

export function rowsOf(run: PreparedRun): Generator<ResultRow> {
  return buildRows(run.plan.entries, run.context);
}
