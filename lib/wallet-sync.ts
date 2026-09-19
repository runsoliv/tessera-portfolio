import type { Holding } from './portfolio.ts';

// Venue perpetual sizes are authoritative on every successful snapshot.
// Locally edited spot balances may retain their explicit quantity adjustment.
export function localWalletQuantityDelta(
  holding: Pick<Holding, 'positionType' | 'amount' | 'walletSnapshotAmount'>,
) {
  if (holding.positionType === 'perp') return 0;
  const snapshotAmount = Number(holding.walletSnapshotAmount);
  return Number.isFinite(snapshotAmount)
    ? holding.amount - snapshotAmount
    : 0;
}
