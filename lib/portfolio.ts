export type PriceSource =
  | 'coingecko'
  | 'dexscreener'
  | 'hyperliquid'
  | 'lighter'
  | 'yahoo'
  | 'manual';
export type AssetClass = 'spot' | 'staked' | 'staking' | 'unstaking';
export type InstrumentType = 'crypto' | 'stock';
export type ImportProfileSource =
  | 'onchain'
  | 'hyperliquid'
  | 'lighter'
  | 'screenshot';

export type ImportProfile = {
  id: string;
  name: string;
  source: ImportProfileSource;
  platform: string;
  address?: string;
  network?: string;
  createdAt: number;
  lastImportedAt: number;
  snapshotVersion?: number;
};

export type ImportContribution = {
  profileId: string;
  amount: number;
  importedAt?: number;
};

export type Holding = {
  id: string;
  name: string;
  symbol: string;
  amount: number;
  source: PriceSource;
  instrumentType?: InstrumentType;
  coinId?: string;
  network?: string;
  address?: string;
  manualPrice?: number;
  costBasis?: number;
  positionType?: 'spot' | 'perp';
  assetClass?: AssetClass;
  platform?: string;
  accountLabel?: string;
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
  targetPrice?: number;
  stopLossPrice?: number;
  reportedLiquidationPrice?: number;
  importedFrom?: 'onchain' | 'hyperliquid' | 'lighter' | 'screenshot';
  importProfileId?: string;
  importContributions?: ImportContribution[];
  walletAddress?: string;
  walletSnapshotAmount?: number;
  importedAt?: number;
  marketRef?: string;
  accountMode?: string;
  price?: number;
  change24h?: number | null;
  marketCap?: number | null;
  volume24h?: number | null;
  liquidity?: number | null;
  provider?: string;
  updatedAt?: number;
  color: string;
};

export type PriceResult = {
  price: number;
  change24h: number | null;
  marketCap: number | null;
  volume24h: number | null;
  liquidity: number | null;
  provider: string;
  updatedAt: number;
  maintenanceMarginRate?: number;
  error?: string;
};

export type PortfolioSnapshot = {
  timestamp: number;
  value: number;
};

export type VenueHistoryPoint = {
  timestamp: number;
  value: number;
  pnl?: number;
};

export type VenueHistorySeries = {
  profileId: string;
  source: 'hyperliquid' | 'lighter';
  platform: 'Hyperliquid' | 'Lighter';
  address: string;
  points: VenueHistoryPoint[];
  pnlPoints?: VenueHistoryPoint[];
  fetchedAt: number;
  provider: string;
  historyVersion?: number;
  warning?: string;
};

export type StoredPortfolio = {
  version: 1;
  holdings: Holding[];
  snapshots: PortfolioSnapshot[];
  venueHistories?: VenueHistorySeries[];
  autoRefresh: boolean;
  privacyMode: boolean;
  minimumPositionValue: number;
  sampleMode?: boolean;
};

export type AssetOption = {
  id: string;
  name: string;
  symbol: string;
  network: string;
};

export const STORAGE_KEY = 'tessera.portfolio.v1';
export const IMPORT_PROFILES_STORAGE_KEY = 'tessera.import-profiles.v1';

export const COLORS = [
  '#c8ff5a',
  '#7da7ff',
  '#ff9f43',
  '#c49aff',
  '#55d6be',
  '#ff7d8f',
  '#74d3ee',
  '#ffcd70',
  '#f28cff',
  '#70b7ff',
];

export const CURATED_ASSETS: AssetOption[] = [
  { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', network: 'Bitcoin' },
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', network: 'Ethereum' },
  { id: 'tether', name: 'Tether', symbol: 'USDT', network: 'Multi-chain' },
  { id: 'binancecoin', name: 'BNB', symbol: 'BNB', network: 'BNB Chain' },
  { id: 'solana', name: 'Solana', symbol: 'SOL', network: 'Solana' },
  { id: 'usd-coin', name: 'USD Coin', symbol: 'USDC', network: 'Multi-chain' },
  { id: 'ripple', name: 'XRP', symbol: 'XRP', network: 'XRP Ledger' },
  {
    id: 'staked-ether',
    name: 'Lido Staked Ether',
    symbol: 'STETH',
    network: 'Ethereum',
  },
  { id: 'dogecoin', name: 'Dogecoin', symbol: 'DOGE', network: 'Dogecoin' },
  { id: 'cardano', name: 'Cardano', symbol: 'ADA', network: 'Cardano' },
  { id: 'tron', name: 'TRON', symbol: 'TRX', network: 'Tron' },
  {
    id: 'avalanche-2',
    name: 'Avalanche',
    symbol: 'AVAX',
    network: 'Avalanche',
  },
  { id: 'chainlink', name: 'Chainlink', symbol: 'LINK', network: 'Ethereum' },
  { id: 'sui', name: 'Sui', symbol: 'SUI', network: 'Sui' },
  { id: 'stellar', name: 'Stellar', symbol: 'XLM', network: 'Stellar' },
  { id: 'hedera-hashgraph', name: 'Hedera', symbol: 'HBAR', network: 'Hedera' },
  { id: 'the-open-network', name: 'Toncoin', symbol: 'TON', network: 'TON' },
  { id: 'polkadot', name: 'Polkadot', symbol: 'DOT', network: 'Polkadot' },
  {
    id: 'matic-network',
    name: 'POL (ex-MATIC)',
    symbol: 'POL',
    network: 'Polygon',
  },
  { id: 'litecoin', name: 'Litecoin', symbol: 'LTC', network: 'Litecoin' },
  {
    id: 'bitcoin-cash',
    name: 'Bitcoin Cash',
    symbol: 'BCH',
    network: 'Bitcoin Cash',
  },
  { id: 'uniswap', name: 'Uniswap', symbol: 'UNI', network: 'Ethereum' },
  { id: 'aave', name: 'Aave', symbol: 'AAVE', network: 'Ethereum' },
  { id: 'near', name: 'NEAR Protocol', symbol: 'NEAR', network: 'NEAR' },
  { id: 'aptos', name: 'Aptos', symbol: 'APT', network: 'Aptos' },
  { id: 'arbitrum', name: 'Arbitrum', symbol: 'ARB', network: 'Arbitrum' },
  { id: 'optimism', name: 'Optimism', symbol: 'OP', network: 'Optimism' },
  {
    id: 'aerodrome-finance',
    name: 'Aerodrome Finance',
    symbol: 'AERO',
    network: 'Base',
  },
  {
    id: 'hyperliquid',
    name: 'Hyperliquid',
    symbol: 'HYPE',
    network: 'Hyperliquid',
  },
];

export const NETWORKS = [
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'solana', label: 'Solana' },
  { id: 'base', label: 'Base' },
  { id: 'arbitrum', label: 'Arbitrum' },
  { id: 'optimism', label: 'Optimism' },
  { id: 'bsc', label: 'BNB Chain' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'avalanche', label: 'Avalanche' },
  { id: 'sui', label: 'Sui' },
  { id: 'linea', label: 'Linea' },
  { id: 'scroll', label: 'Scroll' },
  { id: 'mantle', label: 'Mantle' },
  { id: 'sei', label: 'Sei' },
  { id: 'pulsechain', label: 'PulseChain' },
  { id: 'robinhood', label: 'Robinhood Chain' },
];

export const PLATFORMS = [
  'Self custody',
  'Hyperliquid',
  'Lighter',
  'Robinhood',
  'Robinhood Chain',
  'Coinbase',
  'Binance',
  'Kraken',
  'Bybit',
  'OKX',
  'Fidelity',
  'Charles Schwab',
  'Interactive Brokers',
  'E*TRADE',
  'Webull',
  'Vanguard',
  'Ledger / cold wallet',
] as const;

export function inferPlatform(holding: Partial<Holding>) {
  if (holding.platform?.trim()) return holding.platform.trim();
  if (holding.importedFrom === 'hyperliquid') return 'Hyperliquid';
  if (holding.importedFrom === 'lighter') return 'Lighter';
  const location =
    `${holding.network ?? ''} ${holding.provider ?? ''}`.toLowerCase();
  if (location.includes('robinhood chain')) return 'Robinhood Chain';
  if (location.includes('hyperliquid')) return 'Hyperliquid';
  if (location.includes('lighter')) return 'Lighter';
  if (location.includes('coinbase')) return 'Coinbase';
  if (location.includes('binance')) return 'Binance';
  if (location.includes('kraken')) return 'Kraken';
  if (location.includes('bybit')) return 'Bybit';
  if (location.includes('okx')) return 'OKX';
  return 'Self custody';
}

export function normalizeHolding(holding: Holding): Holding {
  const lighterPerp =
    holding.importedFrom === 'lighter' && holding.positionType === 'perp';
  const lighterVenueSnapshot =
    lighterPerp &&
    (Number.isFinite(Number(holding.reportedUnrealizedPnl)) ||
      Number.isFinite(Number(holding.equityMarkPrice)));
  const lighterSpot =
    holding.importedFrom === 'lighter' && holding.positionType !== 'perp';
  const hyperliquidSpot =
    holding.importedFrom === 'hyperliquid' && holding.positionType !== 'perp';
  const importContributions = holding.importContributions
    ?.filter(
      (contribution) =>
        typeof contribution?.profileId === 'string' &&
        contribution.profileId &&
        Number.isFinite(contribution.amount) &&
        contribution.amount > 0,
    )
    .map((contribution) => ({
      ...contribution,
      amount: Number(contribution.amount),
    }));
  return {
    ...holding,
    source: lighterPerp ? 'lighter' : holding.source,
    instrumentType:
      holding.source === 'yahoo'
        ? 'stock'
        : (holding.instrumentType ?? 'crypto'),
    platform: inferPlatform(holding),
    assetClass:
      holding.positionType === 'perp'
        ? undefined
        : (holding.assetClass ?? 'spot'),
    collateralEligible:
      lighterSpot || hyperliquidSpot
        ? holding.assetClass === 'staked' ||
          holding.assetClass === 'staking' ||
          holding.assetClass === 'unstaking'
          ? false
          : holding.symbol.toUpperCase() === 'USDC' ||
            (hyperliquidSpot &&
              (holding.accountMode === 'unifiedAccount' ||
                holding.accountMode === 'portfolioMargin'))
        : holding.collateralEligible,
    equityOverride:
      lighterVenueSnapshot &&
      !Number.isFinite(Number(holding.equityOverride)) &&
      Number.isFinite(Number(holding.marginCollateral))
        ? Number(holding.marginCollateral)
        : holding.equityOverride,
    liquidationModel: lighterVenueSnapshot
      ? 'reported-only'
      : holding.liquidationModel,
    importContributions: importContributions?.length
      ? importContributions
      : undefined,
  };
}

export function createDemoPortfolio(): StoredPortfolio {
  const now = Date.now();
  const holdings: Holding[] = [
    {
      id: crypto.randomUUID(),
      coinId: 'bitcoin',
      name: 'Bitcoin',
      symbol: 'BTC',
      network: 'Bitcoin',
      platform: 'Self custody',
      amount: 0.2842,
      source: 'coingecko',
      positionType: 'spot',
      assetClass: 'spot',
      price: 64921.29,
      change24h: 3.18,
      marketCap: 1280000000000,
      volume24h: 31200000000,
      provider: 'CoinGecko',
      updatedAt: now,
      color: '#f7931a',
      costBasis: 54800,
      targetPrice: 85000,
    },
    {
      id: crypto.randomUUID(),
      coinId: 'ethereum',
      name: 'Ethereum',
      symbol: 'ETH',
      network: 'Ethereum',
      platform: 'Self custody',
      amount: 4.86,
      source: 'coingecko',
      positionType: 'spot',
      assetClass: 'spot',
      price: 2576.84,
      change24h: 2.44,
      marketCap: 310000000000,
      volume24h: 14800000000,
      provider: 'CoinGecko',
      updatedAt: now,
      color: '#7b82ff',
      costBasis: 2180,
      targetPrice: 4200,
    },
    {
      id: crypto.randomUUID(),
      coinId: 'solana',
      name: 'Solana',
      symbol: 'SOL',
      network: 'Solana',
      platform: 'Self custody',
      amount: 38.2,
      source: 'coingecko',
      positionType: 'spot',
      assetClass: 'spot',
      price: 148.75,
      change24h: -1.26,
      marketCap: 70500000000,
      volume24h: 3700000000,
      provider: 'CoinGecko',
      updatedAt: now,
      color: '#d8ff58',
      costBasis: 121,
      targetPrice: 260,
    },
    {
      id: crypto.randomUUID(),
      coinId: 'usd-coin',
      name: 'USD Coin',
      symbol: 'USDC',
      network: 'Base',
      platform: 'Self custody',
      amount: 4192.21,
      source: 'coingecko',
      positionType: 'spot',
      assetClass: 'spot',
      price: 1,
      change24h: 0.01,
      marketCap: 55000000000,
      volume24h: 8200000000,
      provider: 'CoinGecko',
      updatedAt: now,
      color: '#2775ca',
    },
    {
      id: crypto.randomUUID(),
      coinId: 'aerodrome-finance',
      name: 'Aerodrome Finance',
      symbol: 'AERO',
      network: 'Base',
      platform: 'Self custody',
      amount: 1840,
      source: 'coingecko',
      positionType: 'spot',
      assetClass: 'spot',
      price: 1.087,
      change24h: 6.72,
      marketCap: 910000000,
      volume24h: 26000000,
      provider: 'CoinGecko',
      updatedAt: now,
      color: '#ef78ff',
      costBasis: 0.92,
      targetPrice: 2.4,
    },
    {
      id: crypto.randomUUID(),
      coinId: 'bitcoin',
      name: 'Bitcoin Perpetual',
      symbol: 'BTC',
      network: 'Hyperliquid',
      platform: 'Hyperliquid',
      amount: 0.075,
      source: 'coingecko',
      positionType: 'perp',
      side: 'long',
      leverage: 3,
      entryPrice: 62000,
      marginMode: 'isolated',
      marginCollateral: 1550,
      maintenanceMarginRate: 0.5,
      targetPrice: 78000,
      stopLossPrice: 58000,
      price: 64921.29,
      change24h: 3.18,
      marketCap: 1280000000000,
      volume24h: 31200000000,
      provider: 'CoinGecko',
      updatedAt: now,
      color: '#55e6c1',
    },
  ];
  const currentValue = holdings.reduce((sum, holding) => {
    if (holding.positionType !== 'perp')
      return sum + holding.amount * (holding.price ?? 0);
    const direction = holding.side === 'short' ? -1 : 1;
    return (
      sum +
      Number(
        holding.marginCollateral ??
          (holding.amount * Number(holding.entryPrice)) /
            Number(holding.leverage),
      ) +
      direction *
        holding.amount *
        (Number(holding.price) - Number(holding.entryPrice))
    );
  }, 0);
  return {
    version: 1,
    holdings,
    snapshots: [
      { timestamp: now - 86_400_000, value: currentValue * 0.9724 },
      { timestamp: now - 64_800_000, value: currentValue * 0.979 },
      { timestamp: now - 43_200_000, value: currentValue * 0.968 },
      { timestamp: now - 21_600_000, value: currentValue * 0.989 },
      { timestamp: now, value: currentValue },
    ],
    autoRefresh: true,
    privacyMode: false,
    minimumPositionValue: 10,
    sampleMode: true,
  };
}

export function formatMoney(value: number, compact = false) {
  if (!Number.isFinite(value)) return '$—';
  if (compact && Math.abs(value) >= 1_000_000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value);
  }
  const decimals = Math.abs(value) < 1 && value !== 0 ? 4 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatNumber(value: number, maxDecimals = 6) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: maxDecimals,
  }).format(value);
}
