import assert from 'node:assert/strict';
import test from 'node:test';

import { isSuspiciousSpotPriceJump } from '../lib/price-guard.ts';

void test('rejects a transient eightfold spot-price spike', () => {
  assert.equal(
    isSuspiciousSpotPriceJump(
      { source: 'dexscreener', positionType: 'spot', price: 0.3 },
      { price: 9.6 },
    ),
    true,
  );
});

void test('accepts ordinary movement and downward correction of a bad quote', () => {
  const holding = {
    source: 'coingecko' as const,
    positionType: 'spot' as const,
    price: 9.6,
  };
  assert.equal(isSuspiciousSpotPriceJump(holding, { price: 0.3 }), false);
  assert.equal(isSuspiciousSpotPriceJump(holding, { price: 10.2 }), false);
});

void test('does not block newly added or manually priced holdings', () => {
  assert.equal(
    isSuspiciousSpotPriceJump(
      { source: 'coingecko', positionType: 'spot' },
      { price: 9.6 },
    ),
    false,
  );
  assert.equal(
    isSuspiciousSpotPriceJump(
      { source: 'manual', positionType: 'spot', price: 0.3 },
      { price: 9.6 },
    ),
    false,
  );
});
