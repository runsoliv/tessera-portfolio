import assert from 'node:assert/strict';
import test from 'node:test';

import { localWalletQuantityDelta } from '../lib/wallet-sync.ts';

void test('closed and partially closed venue perps follow the live size', () => {
  const previous = {
    positionType: 'perp' as const,
    amount: 2,
    walletSnapshotAmount: 1,
  };
  assert.equal(localWalletQuantityDelta(previous), 0);
  assert.equal(0 + localWalletQuantityDelta(previous), 0);
  assert.equal(0.5 + localWalletQuantityDelta(previous), 0.5);
});

void test('locally edited spot balances keep their explicit adjustment', () => {
  assert.equal(
    localWalletQuantityDelta({
      positionType: 'spot',
      amount: 3,
      walletSnapshotAmount: 2,
    }),
    1,
  );
});
