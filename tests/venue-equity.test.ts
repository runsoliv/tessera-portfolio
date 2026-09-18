import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileVenueEquity } from '../lib/venue-equity.ts';

void test('includes usable unrealized profit in account leverage exactly once', () => {
  const notional = 5_126.05;
  const margin = 631.94;
  const unrealizedPnl = 738.7;
  const equity = reconcileVenueEquity(margin + unrealizedPnl, unrealizedPnl, [
    margin,
  ]);

  assert.equal(equity.accountEquity, 1_370.64);
  assert.equal(equity.availableEquity, unrealizedPnl);
  assert.equal(equity.positionEquities[0], margin);
  assert.equal(Number((notional / equity.accountEquity).toFixed(2)), 3.74);
});

void test('uses venue account equity when losses push it below margin used', () => {
  const equity = reconcileVenueEquity(500, 0, [400, 200]);

  assert.equal(equity.accountEquity, 500);
  assert.equal(equity.availableEquity, 0);
  assert.deepEqual(
    equity.positionEquities.map((value) => Number(value.toFixed(6))),
    [333.333333, 166.666667],
  );
  assert.equal(
    Number(
      (
        equity.availableEquity +
        equity.positionEquities.reduce((sum, value) => sum + value, 0)
      ).toFixed(6),
    ),
    500,
  );
});

void test('falls back to free balance plus margin when account equity is absent', () => {
  const equity = reconcileVenueEquity(undefined, 125, [300, 75]);

  assert.equal(equity.accountEquity, 500);
  assert.equal(equity.availableEquity, 125);
  assert.deepEqual(equity.positionEquities, [300, 75]);
});
