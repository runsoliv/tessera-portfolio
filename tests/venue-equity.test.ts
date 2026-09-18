import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reconcileVenueEquity,
  usableVenuePositionEquity,
} from '../lib/venue-equity.ts';

void test('uses signed open P&L as usable Lighter and Hyperliquid equity', () => {
  const margin = 631.94;
  const unrealizedPnl = 765.58;
  const notional = 5_152.93;

  for (const importedFrom of ['lighter', 'hyperliquid']) {
    const equity = usableVenuePositionEquity({
      importedFrom,
      margin,
      unrealizedPnl,
      reportedEquity: margin,
    });
    assert.equal(equity, 1_397.52);
    assert.equal(Number((notional / equity).toFixed(2)), 3.69);
  }
});

void test('keeps venue portfolio value separate from the leverage denominator', () => {
  const margins = [331.4, 270.27, 123.28];
  const openPnl = [334.4, 405.85, 52.52];
  const account = reconcileVenueEquity(1_165.04, 440.09, margins);
  const portfolioValue =
    account.availableEquity +
    account.positionEquities.reduce((sum, value) => sum + value, 0);
  const leverageEquity = margins.reduce(
    (sum, margin, index) =>
      sum +
      usableVenuePositionEquity({
        importedFrom: 'lighter',
        margin,
        unrealizedPnl: openPnl[index],
        reportedEquity: account.positionEquities[index],
      }),
    0,
  );

  assert.equal(Number(portfolioValue.toFixed(2)), 1_165.04);
  assert.equal(Number(leverageEquity.toFixed(2)), 1_517.72);
  assert.notEqual(portfolioValue, leverageEquity);
  assert.equal(Number((5_177.24 / leverageEquity).toFixed(2)), 3.41);
});

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
