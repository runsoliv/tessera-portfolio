import type { AssetClass, PriceSource } from '@/lib/portfolio';
import type { WalletHistoryPayload } from '@/lib/venue-history';

export type WalletImportSource = 'onchain' | 'hyperliquid' | 'lighter';

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
