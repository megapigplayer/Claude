/**
 * Deliver rows to the dataset in order, in batches, charging only for rows that carry an answer
 * (pure: the Apify calls are injected as ports, so the budget logic is unit-tested).
 *
 * Paid rows (ok=true) and free rows (problem notices) alternate in the result order. Runs of the
 * same kind are pushed together: paid runs through the charging push, free runs through a plain push.
 * A paid run is never larger than the remaining budget; when the budget is exhausted the run stops
 * cleanly (everything delivered so far stays, the rest is reported as not delivered).
 */

export interface EmitRow {
  ok: boolean;
}

export interface PaidPushResult {
  ok: boolean;
  /** Rows actually saved (fewer than sent when maxTotalChargeUsd cut the batch). */
  pushedCount: number;
}

export interface EmitPorts<R extends EmitRow> {
  /** How many more paid rows fit in the caller's budget (Infinity when unlimited). */
  remainingPaid(): number;
  pushPaid(rows: R[]): Promise<PaidPushResult>;
  pushFree(rows: R[]): Promise<{ ok: boolean }>;
  /** Called with every row that was really saved. */
  onSaved?(rows: R[]): void;
}

export interface EmitResult {
  pushedPaid: number;
  pushedFree: number;
  /** Rows lost because a push failed (infrastructure problem). */
  unsaved: number;
  stoppedForBudget: boolean;
  /** Rows never delivered because the budget ran out (rows lost to a failed push are counted in `unsaved`). */
  notDelivered: number;
}

export async function emitRows<R extends EmitRow>(rows: Iterable<R>, ports: EmitPorts<R>, batchSize = 50): Promise<EmitResult> {
  const result: EmitResult = { pushedPaid: 0, pushedFree: 0, unsaved: 0, stoppedForBudget: false, notDelivered: 0 };
  let buffer: R[] = [];
  let bufferPaid = false;

  /** Push the buffered run. Returns false when the run must stop (budget exhausted). */
  const flush = async (): Promise<boolean> => {
    if (buffer.length === 0) return true;
    const batch = buffer;
    buffer = [];
    if (!bufferPaid) {
      const out = await ports.pushFree(batch);
      if (!out.ok) {
        result.unsaved += batch.length;
        return true; // keep going: free rows are informational
      }
      result.pushedFree += batch.length;
      ports.onSaved?.(batch);
      return true;
    }
    const remaining = ports.remainingPaid();
    if (remaining <= 0) {
      result.stoppedForBudget = true;
      result.notDelivered += batch.length;
      return false;
    }
    const sendable = batch.length > remaining ? batch.slice(0, Math.floor(remaining)) : batch;
    const out = await ports.pushPaid(sendable);
    if (!out.ok) {
      result.unsaved += sendable.length;
      if (sendable.length < batch.length) {
        result.stoppedForBudget = true;
        result.notDelivered += batch.length - sendable.length;
        return false;
      }
      return true;
    }
    result.pushedPaid += out.pushedCount;
    ports.onSaved?.(sendable.slice(0, out.pushedCount));
    if (out.pushedCount < batch.length) {
      result.stoppedForBudget = true;
      result.notDelivered += batch.length - out.pushedCount;
      return false;
    }
    return true;
  };

  let stopped = false;
  for (const row of rows) {
    if (stopped) {
      result.notDelivered += 1; // drained only to count what was not delivered
      continue;
    }
    if (buffer.length > 0 && (row.ok !== bufferPaid || buffer.length >= batchSize)) {
      if (!(await flush())) {
        stopped = true;
        result.notDelivered += 1;
        continue;
      }
    }
    bufferPaid = row.ok;
    buffer.push(row);
  }
  if (!stopped) await flush();
  return result;
}
