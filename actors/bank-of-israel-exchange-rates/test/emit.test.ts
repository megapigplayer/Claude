import { describe, expect, it } from 'vitest';
import { type EmitPorts, emitRows } from '../src/lib/emit.js';

interface Row {
  id: number;
  ok: boolean;
}

function harness(opts: { budget?: number; failPaidAt?: number[]; failFree?: boolean } = {}) {
  const pushes: Array<{ kind: 'paid' | 'free'; ids: number[] }> = [];
  let budget = opts.budget ?? Number.POSITIVE_INFINITY;
  let paidCalls = 0;
  const saved: number[] = [];
  const ports: EmitPorts<Row> = {
    remainingPaid: () => budget,
    pushPaid: (rows) => {
      paidCalls++;
      if (opts.failPaidAt?.includes(paidCalls)) return Promise.resolve({ ok: false, pushedCount: 0 });
      const take = Math.min(rows.length, Math.max(0, budget));
      budget -= take;
      pushes.push({ kind: 'paid', ids: rows.slice(0, take).map((r) => r.id) });
      return Promise.resolve({ ok: true, pushedCount: take });
    },
    pushFree: (rows) => {
      if (opts.failFree) return Promise.resolve({ ok: false });
      pushes.push({ kind: 'free', ids: rows.map((r) => r.id) });
      return Promise.resolve({ ok: true });
    },
    onSaved: (rows) => saved.push(...rows.map((r) => r.id)),
  };
  return { ports, pushes, saved };
}

const rows = (spec: string): Row[] => [...spec].map((c, id) => ({ id, ok: c === 'p' }));

describe('emitRows', () => {
  it('keeps result order and splits runs of paid and free rows', async () => {
    const h = harness();
    const result = await emitRows(rows('ppfpffp'), h.ports, 50);
    expect(h.pushes).toEqual([
      { kind: 'paid', ids: [0, 1] },
      { kind: 'free', ids: [2] },
      { kind: 'paid', ids: [3] },
      { kind: 'free', ids: [4, 5] },
      { kind: 'paid', ids: [6] },
    ]);
    expect(result).toEqual({ pushedPaid: 4, pushedFree: 3, unsaved: 0, stoppedForBudget: false, notDelivered: 0 });
    expect(h.saved).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('batches long runs at batchSize', async () => {
    const h = harness();
    await emitRows(rows('p'.repeat(7)), h.ports, 3);
    expect(h.pushes.map((p) => p.ids.length)).toEqual([3, 3, 1]);
  });

  it('never sends more paid rows than the remaining budget and stops cleanly', async () => {
    const h = harness({ budget: 4 });
    const result = await emitRows(rows('p'.repeat(10)), h.ports, 3);
    expect(h.pushes.flatMap((p) => p.ids)).toEqual([0, 1, 2, 3]);
    expect(result).toMatchObject({ pushedPaid: 4, stoppedForBudget: true, notDelivered: 6, unsaved: 0 });
  });

  it('stops before the first paid row when the budget is already zero', async () => {
    const h = harness({ budget: 0 });
    const result = await emitRows(rows('ppp'), h.ports);
    expect(h.pushes).toEqual([]);
    expect(result).toMatchObject({ pushedPaid: 0, stoppedForBudget: true, notDelivered: 3 });
  });

  it('delivers free rows that precede the budget stop', async () => {
    const h = harness({ budget: 0 });
    const result = await emitRows(rows('ffpp'), h.ports);
    expect(h.pushes).toEqual([{ kind: 'free', ids: [0, 1] }]);
    expect(result).toMatchObject({ pushedFree: 2, pushedPaid: 0, notDelivered: 2 });
  });

  it('counts rows of a failed push as unsaved (no retry) and continues', async () => {
    const h = harness({ failPaidAt: [1] });
    const result = await emitRows(rows('ppfp'), h.ports);
    expect(result).toMatchObject({ unsaved: 2, pushedPaid: 1, pushedFree: 1, stoppedForBudget: false });
    expect(h.saved).toEqual([2, 3]);
  });

  it('a failed free push counts as unsaved but does not stop the run', async () => {
    const h = harness({ failFree: true });
    const result = await emitRows(rows('fpf'), h.ports);
    expect(result).toMatchObject({ unsaved: 2, pushedPaid: 1 });
  });

  it('handles an empty input', async () => {
    const h = harness();
    expect(await emitRows([], h.ports)).toEqual({ pushedPaid: 0, pushedFree: 0, unsaved: 0, stoppedForBudget: false, notDelivered: 0 });
  });

  it('works with a lazy generator source', async () => {
    const h = harness();
    function* gen(): Generator<Row> {
      for (let i = 0; i < 5; i++) yield { id: i, ok: true };
    }
    expect((await emitRows(gen(), h.ports, 2)).pushedPaid).toBe(5);
  });
});
