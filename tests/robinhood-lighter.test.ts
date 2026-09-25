import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeHolding,
  usesLighterVenuePrice,
  type Holding,
} from '../lib/portfolio.ts';

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

void test('prices imported liquid and staked LIT from the Lighter venue', () => {
  const base = {
    source: 'lighter' as const,
    importedFrom: 'lighter' as const,
    positionType: 'spot' as const,
  };

  assert.equal(usesLighterVenuePrice({ ...base, symbol: 'LIT' }), true);
  assert.equal(usesLighterVenuePrice({ ...base, symbol: 'AAVE' }), false);
  assert.equal(
    usesLighterVenuePrice({
      ...base,
      positionType: 'perp',
      symbol: 'BTC',
    }),
    true,
  );
});
