import assert from 'node:assert/strict';
import test from 'node:test';

import { incompleteWalletSnapshotKinds } from '../lib/wallet-import.ts';

void test('keeps Lighter spot holdings when the venue omits its assets field', () => {
  const missingSpot = incompleteWalletSnapshotKinds('lighter', [
    'Lighter spot balances could not be read.',
  ]);
  assert.deepEqual([...missingSpot], ['spot']);
  assert.deepEqual([...incompleteWalletSnapshotKinds('lighter', [])], []);
});
