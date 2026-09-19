import type { AssetClass, PriceSource } from '@/lib/portfolio';
import type { WalletHistoryPayload } from '@/lib/venue-history';

export type WalletImportSource = 'onchain' | 'hyperliquid' | 'lighter';

export type WalletSnapshotKind = 'perp' | 'spot' | 'staking';

export function incompleteWalletSnapshotKinds(
  source: WalletImportSource,
  warnings: string[] = [],
) {
  const kinds = new Set<WalletSnapshotKind>();
  const normalized = warnings.join(' ').toLowerCase();
  if (
    normalized.includes('staking metadata was unavailable') ||
    normalized.includes('staked hype balances could not be read')
  )
    kinds.add('staking');
  if (source === 'hyperliquid' || source === 'lighter') {
    if (normalized.includes('perpetual positions could not be read'))
      kinds.add('perp');
    if (normalized.includes('spot balances could not be read'))
      kinds.add('spot');
  }
  return kinds;
}

export type WalletImportCandidate = {
  id: string;
  name: string;
  symbol: string;
  amount: number;
  positionType: 'spot' | 'perp';
  assetClass?: AssetClass;
  platform: string;
  network: string;
  priceSource: PriceSource;
  provider: string;
  price?: number;
  estimatedValue?: number;
  coinId?: string;
  address?: string;
  side?: 'long' | 'short';
  leverage?: number;
  entryPrice?: number;
  marginMode?: 'cross' | 'isolated';
  marginCollateral?: number;
  collateralEligible?: boolean;
  equityOverride?: number;
  equityMarkPrice?: number;
  roeBasis?: number;
  reportedRoe?: number;
  reportedUnrealizedPnl?: number;
  stakingPrincipalAmount?: number;
  stakingRewardsAmount?: number;
  stakingRewardsSource?: 'reported' | 'derived';
  liquidationModel?: 'estimate' | 'reported-only';
  maintenanceMarginRate?: number;
  reportedLiquidationPrice?: number;
  costBasis?: number;
  accountLabel?: string;
  marketRef?: string;
  accountMode?: string;
  change24h?: number | null;
  marketCap?: number | null;
  volume24h?: number | null;
  liquidity?: number | null;
};

export type WalletImportResponse = {
  source: WalletImportSource;
  address: string;
  network?: string;
  items: WalletImportCandidate[];
  warnings: string[];
  fetchedAt: number;
};

export type WalletHistoryResponse = {
  source: 'hyperliquid' | 'lighter';
  address: string;
  history: WalletHistoryPayload;
};

export type SolanaWalletSnapshot = {
  lamports: number;
  tokens: Array<{ mint: string; amount: number }>;
  warnings?: string[];
};

export type QuantityAdjustment = {
  operation: 'increase' | 'decrease';
  quantity: number;
  executionPrice?: number;
  marginAmount?: number;
};
