import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeHolding, type Holding } from '../lib/portfolio.ts';

void test('keeps Robinhood Lighter USDG as available venue collateral', () => {
  const holding: Holding = {
    id: 'rh-usdg',
    name: 'USDG',
    symbol: 'USDG',
    amount: 118,
    source: 'manual',
    positionType: 'spot',
    assetClass: 'spot',
    importedFrom: 'lighter',
    network: 'Robinhood Lighter',
    price: 1,
    color: '#fff',
  };

  assert.equal(normalizeHolding(holding).collateralEligible, true);
  assert.equal(
    normalizeHolding({ ...holding, network: 'Lighter' }).collateralEligible,
    false,
  );
});
