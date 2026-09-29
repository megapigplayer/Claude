import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  charge: vi.fn(),
  pushData: vi.fn(),
  getChargingManager: vi.fn(),
  warningOnce: vi.fn(),
  error: vi.fn(),
}));

vi.mock('apify', () => ({
  Actor: {
    charge: mocks.charge,
    pushData: mocks.pushData,
    getChargingManager: mocks.getChargingManager,
  },
  log: { warningOnce: mocks.warningOnce, error: mocks.error },
}));

import {
  chargeEvent,
  describeCharging,
  isBudgetExhausted,
  pushResultAndCharge,
  pushResultsAndCharge,
  remainingChargeable,
} from '../src/lib/ppe.js';

const chargeResult = (chargedCount: number, eventChargeLimitReached = false) => ({
  chargedCount,
  eventChargeLimitReached,
  chargeableWithinLimit: {},
});

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
});

describe('chargeEvent', () => {
  it('maps the SDK ChargeResult', async () => {
    mocks.charge.mockResolvedValue(chargeResult(3, true));
    await expect(chargeEvent('e', 3)).resolves.toEqual({ ok: true, chargedCount: 3, limitReached: true });
    expect(mocks.charge).toHaveBeenCalledWith({ eventName: 'e', count: 3 });
  });

  it('charges 1 by default', async () => {
    mocks.charge.mockResolvedValue(chargeResult(1));
    await chargeEvent('e');
    expect(mocks.charge).toHaveBeenCalledWith({ eventName: 'e', count: 1 });
  });

  it('never throws when the SDK throws; reports ok=false', async () => {
    mocks.charge.mockRejectedValue(new Error('boom'));
    await expect(chargeEvent('e')).resolves.toMatchObject({ ok: false, chargedCount: 0, error: 'boom' });
  });

  it('treats the local no-PPE result (chargedCount 0) as a normal outcome', async () => {
    mocks.charge.mockResolvedValue(chargeResult(0));
    await expect(chargeEvent('e')).resolves.toEqual({ ok: true, chargedCount: 0, limitReached: false });
  });
});

describe('pushResultsAndCharge / pushResultAndCharge', () => {
  it('pushes the whole batch with the event name (one SDK call) and maps the result', async () => {
    mocks.getChargingManager.mockReturnValue({ getPricingInfo: () => ({ isPayPerEvent: false }) });
    mocks.pushData.mockResolvedValue(chargeResult(0));
    const rows = [{ a: 1 }, { a: 2 }];
    const out = await pushResultsAndCharge(rows, 'e');
    expect(mocks.pushData).toHaveBeenCalledTimes(1);
    expect(mocks.pushData).toHaveBeenCalledWith(rows, 'e');
    // outside PPE runs the SDK saves every row and charges nothing
    expect(out).toEqual({ ok: true, pushedCount: 2, chargedCount: 0, limitReached: false });
  });

  it('derives pushedCount from the per-event counter in PPE runs (the SDK drops rows beyond the budget)', async () => {
    const counter = vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(13);
    mocks.getChargingManager.mockReturnValue({ getPricingInfo: () => ({ isPayPerEvent: true }), getChargedEventCount: counter });
    mocks.pushData.mockResolvedValue(chargeResult(6, true)); // chargedCount also sums the synthetic event: not the row count
    const out = await pushResultsAndCharge([{}, {}, {}, {}, {}], 'e');
    expect(counter).toHaveBeenCalledWith('e');
    expect(out).toEqual({ ok: true, pushedCount: 3, chargedCount: 6, limitReached: true });
  });

  it('never claims more saved rows than were requested', async () => {
    const counter = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(99);
    mocks.getChargingManager.mockReturnValue({ getPricingInfo: () => ({ isPayPerEvent: true }), getChargedEventCount: counter });
    mocks.pushData.mockResolvedValue(chargeResult(99));
    expect((await pushResultsAndCharge([{}, {}], 'e')).pushedCount).toBe(2);
  });

  it('assumes all rows were saved when the charging state is unreadable', async () => {
    mocks.getChargingManager.mockImplementation(() => {
      throw new Error('not initialized');
    });
    mocks.pushData.mockResolvedValue(chargeResult(0));
    expect((await pushResultsAndCharge([{}, {}, {}], 'e')).pushedCount).toBe(3);
  });

  it('does nothing for an empty batch', async () => {
    await expect(pushResultsAndCharge([], 'e')).resolves.toEqual({ ok: true, pushedCount: 0, chargedCount: 0, limitReached: false });
    expect(mocks.pushData).not.toHaveBeenCalled();
  });

  it('single-row wrapper pushes a one-element batch', async () => {
    mocks.getChargingManager.mockReturnValue({ getPricingInfo: () => ({ isPayPerEvent: false }) });
    mocks.pushData.mockResolvedValue(chargeResult(0));
    await pushResultAndCharge({ a: 1 }, 'e');
    expect(mocks.pushData).toHaveBeenCalledWith([{ a: 1 }], 'e');
  });

  it('never throws, and does NOT retry (a retry could duplicate rows)', async () => {
    mocks.pushData.mockRejectedValue(new Error('push failed'));
    const out = await pushResultsAndCharge([{ a: 1 }], 'e');
    expect(out).toMatchObject({ ok: false, pushedCount: 0, chargedCount: 0, error: 'push failed' });
    expect(mocks.pushData).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalled();
  });
});

describe('remainingChargeable / isBudgetExhausted', () => {
  it('exposes how many events still fit in the budget', () => {
    mocks.getChargingManager.mockReturnValue({ calculateMaxEventChargeCountWithinLimit: () => 7 });
    expect(remainingChargeable('e')).toBe(7);
    expect(isBudgetExhausted('e')).toBe(false);
  });

  it('is exhausted when zero more events fit', () => {
    mocks.getChargingManager.mockReturnValue({ calculateMaxEventChargeCountWithinLimit: () => 0 });
    expect(isBudgetExhausted('e')).toBe(true);
  });

  it('is unlimited outside PPE runs (SDK returns Infinity)', () => {
    mocks.getChargingManager.mockReturnValue({ calculateMaxEventChargeCountWithinLimit: () => Infinity });
    expect(remainingChargeable('e')).toBe(Infinity);
    expect(isBudgetExhausted('e')).toBe(false);
  });

  it('never blocks when charging state cannot be read', () => {
    mocks.getChargingManager.mockImplementation(() => {
      throw new Error('ChargingManager is not initialized');
    });
    expect(remainingChargeable('e')).toBe(Infinity);
    expect(isBudgetExhausted('e')).toBe(false);
  });
});

describe('describeCharging', () => {
  it('describes the modes', () => {
    mocks.getChargingManager.mockReturnValue({ getPricingInfo: () => ({ isPayPerEvent: false, maxTotalChargeUsd: Infinity }) });
    expect(describeCharging()).toMatch(/not active/);
    mocks.getChargingManager.mockReturnValue({ getPricingInfo: () => ({ isPayPerEvent: true, maxTotalChargeUsd: 2.5 }) });
    expect(describeCharging()).toMatch(/\$2\.5/);
    mocks.getChargingManager.mockReturnValue({ getPricingInfo: () => ({ isPayPerEvent: true, maxTotalChargeUsd: Infinity }) });
    expect(describeCharging()).toMatch(/unlimited/);
    mocks.getChargingManager.mockImplementation(() => {
      throw new Error('x');
    });
    expect(describeCharging()).toMatch(/unavailable/);
  });
});
