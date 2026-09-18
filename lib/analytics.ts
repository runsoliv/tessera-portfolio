import {
  COLORS,
  inferPlatform,
  type Holding,
  type PortfolioSnapshot,
} from '@/lib/portfolio';
import { repairTransientCompositionSpikes } from '@/lib/history-utils';
import { usableVenuePositionEquity } from '@/lib/venue-equity';

export {
  rebasePortfolioSnapshots,
  repairTransientCompositionSpikes,
} from '@/lib/history-utils';

export type PresetRange = '1D' | '1W' | '1M' | '1Y' | 'ALL';
export type Range = PresetRange | 'CUSTOM';
export type CustomHistoryRange = { start: number; end: number };

export type ValuedHolding = Holding & {
  positionKind: 'spot' | 'perp';
  value: number;
  allocation: number;
  exposureValue: number;
  exposureAllocation: number;
  leverageEquity: number;
  dayPnl: number;
  unrealizedPnl: number | null;
  stakingRewardsQuantity: number | null;
  stakingRewardsValue: number | null;
  notional: number;
  margin: number;
  roe: number | null;
  liquidationPrice: number | null;
  liquidationDistance: number | null;
  targetValue: number;
  targetDelta: number;
  stopValue: number | null;
  plannedReward: number | null;
  plannedRisk: number | null;
  riskReward: number | null;
};

const stablecoins = new Set([
  'USDT',
  'USDC',
  'DAI',
  'FDUSD',
  'USDE',
  'PYUSD',
  'TUSD',
  'USDS',
]);

export function calculateAnalytics(
  source: Holding[],
  minimumPositionValue = 10,
) {
  const cutoff =
    Number.isFinite(minimumPositionValue) && minimumPositionValue >= 0
      ? minimumPositionValue
      : 10;
  const allBase = source.map((holding): ValuedHolding => {
    const price = Number(holding.price ?? holding.manualPrice ?? 0);
    const positionKind = holding.positionType ?? 'spot';
    const isPerp = positionKind === 'perp';
    const entryPrice = Number(holding.entryPrice ?? price);
    const leverage = Math.max(1, Number(holding.leverage ?? 1));
    const direction = holding.side === 'short' ? -1 : 1;
    const notional = Number.isFinite(price) ? holding.amount * price : 0;
    const entryNotional = Number.isFinite(entryPrice)
      ? holding.amount * entryPrice
      : 0;
    const snapshotMargin = Number(
      holding.marginCollateral ?? entryNotional / leverage,
    );
    const venueMarkDelta =
      Number.isFinite(Number(holding.equityMarkPrice)) &&
      Number(holding.equityMarkPrice) > 0
        ? direction * holding.amount * (price - Number(holding.equityMarkPrice))
        : 0;
    const usesLiveCrossMargin =
      isPerp &&
      holding.marginMode === 'cross' &&
      (holding.importedFrom === 'lighter' ||
        holding.importedFrom === 'hyperliquid');
    const usesLiveIsolatedEquity =
      isPerp &&
      holding.marginMode === 'isolated' &&
      holding.importedFrom === 'hyperliquid' &&
      Number.isFinite(snapshotMargin);
    const margin = !isPerp
      ? 0
      : usesLiveCrossMargin
        ? notional / leverage
        : usesLiveIsolatedEquity
          ? Math.max(0, snapshotMargin + venueMarkDelta)
          : snapshotMargin;
    const calculatedPerpPnl = isPerp
      ? direction * holding.amount * (price - entryPrice)
      : 0;
    const reportedPerpPnl = Number(holding.reportedUnrealizedPnl);
    const reportedPnlMark = Number(holding.equityMarkPrice);
    const perpPnl =
      isPerp && Number.isFinite(reportedPerpPnl)
        ? reportedPerpPnl +
          (Number.isFinite(reportedPnlMark)
            ? direction * holding.amount * (price - reportedPnlMark)
            : 0)
        : calculatedPerpPnl;
    const reportedEquity = Number(holding.equityOverride);
    const equityMarkPrice = Number(holding.equityMarkPrice);
    const liveReportedEquity =
      reportedEquity +
      (Number.isFinite(equityMarkPrice)
        ? direction * holding.amount * (price - equityMarkPrice)
        : 0);
    const value = isPerp
      ? Number.isFinite(reportedEquity) && reportedEquity >= 0
        ? Math.max(0, liveReportedEquity)
        : Math.max(0, margin + perpPnl)
      : notional;
    const leverageEquity = isPerp
      ? usableVenuePositionEquity({
          importedFrom: holding.importedFrom,
          margin,
          unrealizedPnl: perpPnl,
          reportedEquity: liveReportedEquity,
        })
      : 0;
    const change = Number(holding.change24h);
    const previousPrice =
      Number.isFinite(change) && change > -99.99
        ? price / (1 + change / 100)
        : price;
    const dayPnl =
      holding.change24h == null
        ? 0
        : isPerp
          ? direction * holding.amount * (price - previousPrice)
          : notional - holding.amount * previousPrice;
    const unrealizedPnl = isPerp
      ? perpPnl
      : holding.costBasis == null
        ? null
        : value - holding.amount * holding.costBasis;
    const rawStakingRewards = Number(holding.stakingRewardsAmount);
    const stakingRewardsQuantity =
      !isPerp && Number.isFinite(rawStakingRewards) && rawStakingRewards >= 0
        ? rawStakingRewards
        : null;
    const stakingRewardsValue =
      stakingRewardsQuantity != null && Number.isFinite(price)
        ? stakingRewardsQuantity * price
        : null;
    const effectivePositionLeverage =
      isPerp && margin > 0 ? notional / margin : leverage;
    const maintenance = Number(holding.maintenanceMarginRate ?? 0.5) / 100;
    const reportedLiquidationPrice = Number(holding.reportedLiquidationPrice);
    const liquidationPrice =
      isPerp &&
      Number.isFinite(reportedLiquidationPrice) &&
      reportedLiquidationPrice > 0
        ? reportedLiquidationPrice
        : isPerp &&
            holding.liquidationModel !== 'reported-only' &&
            entryPrice > 0
          ? Math.max(
              0,
              direction > 0
                ? entryPrice * (1 - 1 / effectivePositionLeverage + maintenance)
                : entryPrice *
                    (1 + 1 / effectivePositionLeverage - maintenance),
            )
          : null;
    const liquidationDistance =
      liquidationPrice != null && price > 0
        ? (Math.abs(price - liquidationPrice) / price) * 100
        : null;
    const targetPrice = Number(holding.targetPrice ?? price);
    const targetValue = isPerp
      ? value + direction * holding.amount * (targetPrice - price)
      : holding.amount * targetPrice;
    const stopValue =
      isPerp && holding.stopLossPrice != null
        ? value + direction * holding.amount * (holding.stopLossPrice - price)
        : null;
    const plannedReward =
      isPerp && holding.targetPrice != null
        ? Math.max(
            0,
            direction * holding.amount * (holding.targetPrice - entryPrice),
          )
        : null;
    const plannedRisk =
      isPerp && holding.stopLossPrice != null
        ? Math.abs(
            direction * holding.amount * (holding.stopLossPrice - entryPrice),
          )
        : null;
    return {
      ...holding,
      platform: inferPlatform(holding),
      positionKind,
      value,
      allocation: 0,
      exposureValue: isPerp ? notional : value,
      exposureAllocation: 0,
      leverageEquity,
      dayPnl,
      unrealizedPnl,
      stakingRewardsQuantity,
      stakingRewardsValue,
      notional,
      margin,
      roe:
        isPerp && Number(holding.roeBasis) > 0
          ? (perpPnl / Number(holding.roeBasis)) * 100
          : isPerp && Number.isFinite(holding.reportedRoe)
            ? Number(holding.reportedRoe)
            : isPerp && margin
              ? (perpPnl / margin) * 100
              : null,
      liquidationPrice,
      liquidationDistance,
      targetValue,
      targetDelta: targetValue - value,
      stopValue,
      plannedReward,
      plannedRisk,
      riskReward:
        plannedReward != null && plannedRisk
          ? plannedReward / plannedRisk
          : null,
    };
  });

  const rawAssetExposure = new Map<string, number>();
  for (const holding of allBase) {
    const symbol = holding.symbol.toUpperCase();
    const assetKey = `${holding.instrumentType === 'stock' ? 'stock' : 'crypto'}:${symbol}`;
    rawAssetExposure.set(
      assetKey,
      (rawAssetExposure.get(assetKey) ?? 0) + holding.exposureValue,
    );
  }
  const countedSymbols = new Set(
    Array.from(rawAssetExposure)
      .filter(([, exposure]) => exposure >= cutoff)
      .map(([assetKey]) => assetKey),
  );
  const holdingAssetKey = (holding: ValuedHolding) =>
    `${holding.instrumentType === 'stock' ? 'stock' : 'crypto'}:${holding.symbol.toUpperCase()}`;
  const base = allBase.filter((holding) =>
    countedSymbols.has(holdingAssetKey(holding)),
  );
  const dustHoldings = allBase
    .filter((holding) => !countedSymbols.has(holdingAssetKey(holding)))
    .sort((a, b) => b.exposureValue - a.exposureValue);
  const totalValue = base.reduce((sum, holding) => sum + holding.value, 0);
  const grossExposure = base.reduce(
    (sum, holding) => sum + holding.exposureValue,
    0,
  );
  const holdings = base
    .map((holding) => ({
      ...holding,
      allocation: totalValue ? (holding.value / totalValue) * 100 : 0,
      exposureAllocation: grossExposure
        ? (holding.exposureValue / grossExposure) * 100
        : 0,
    }))
    .sort((a, b) => b.value - a.value);
  const exposureHoldings = [...holdings].sort(
    (a, b) => b.exposureValue - a.exposureValue,
  );
  const dayPnl = holdings.reduce((sum, holding) => sum + holding.dayPnl, 0);
  const previousTotal = totalValue - dayPnl;
  const covered = holdings.filter(
    (holding) => holding.positionKind === 'spot' && holding.costBasis != null,
  );
  const coveredValue = covered.reduce((sum, holding) => sum + holding.value, 0);
  const totalCost = covered.reduce(
    (sum, holding) => sum + holding.amount * Number(holding.costBasis),
    0,
  );
  const networks = new Set(
    holdings.map((holding) => holding.network).filter(Boolean),
  );
  const providers = new Set(
    holdings.map((holding) => holding.provider).filter(Boolean),
  );
  const spot = holdings.filter((holding) => holding.positionKind === 'spot');
  const stocks = spot.filter((holding) => holding.instrumentType === 'stock');
  const cryptoSpot = spot.filter(
    (holding) => holding.instrumentType !== 'stock',
  );
  const perps = holdings.filter((holding) => holding.positionKind === 'perp');
  const staked = spot.filter(
    (holding) =>
      holding.assetClass === 'staked' ||
      holding.assetClass === 'staking' ||
      holding.assetClass === 'unstaking',
  );
  const stablecoinValue = spot
    .filter((holding) => stablecoins.has(holding.symbol.toUpperCase()))
    .reduce((sum, holding) => sum + holding.value, 0);
  const changed = holdings.filter((holding) => holding.change24h != null);
  const spotValue = spot.reduce((sum, holding) => sum + holding.value, 0);
  const stockValue = stocks.reduce((sum, holding) => sum + holding.value, 0);
  const cryptoSpotValue = cryptoSpot.reduce(
    (sum, holding) => sum + holding.value,
    0,
  );
  const perpEquity = perps.reduce((sum, holding) => sum + holding.value, 0);
  const perpNotional = perps.reduce(
    (sum, holding) => sum + holding.notional,
    0,
  );
  const marginUsed = perps.reduce((sum, holding) => sum + holding.margin, 0);
  const leverageEquity = perps.reduce(
    (sum, holding) => sum + holding.leverageEquity,
    0,
  );
  const perpPnl = perps.reduce(
    (sum, holding) => sum + Number(holding.unrealizedPnl ?? 0),
    0,
  );
  const leveragedPlatforms = new Set(
    perps.map((holding) => holding.platform ?? 'Self custody'),
  );
  const marginEligibleSpotValue = spot
    .filter(
      (holding) =>
        leveragedPlatforms.has(holding.platform ?? 'Self custody') &&
        holding.assetClass !== 'staked' &&
        holding.assetClass !== 'staking' &&
        holding.assetClass !== 'unstaking' &&
        holding.collateralEligible !== false,
    )
    .reduce((sum, holding) => sum + holding.value, 0);
  const tradingEquity = perpEquity + marginEligibleSpotValue;
  const netPerpNotional = perps.reduce(
    (sum, holding) =>
      sum + (holding.side === 'short' ? -holding.notional : holding.notional),
    0,
  );
  const netExposure = spotValue + netPerpNotional;
  const assetMap = new Map<
    string,
    {
      key: string;
      symbol: string;
      name: string;
      instrumentType: 'crypto' | 'stock';
      value: number;
      exposureValue: number;
      positionCount: number;
      hasSpot: boolean;
      hasPerp: boolean;
      color: string;
    }
  >();
  for (const holding of holdings) {
    const symbol = holding.symbol.toUpperCase();
    const instrumentType =
      holding.instrumentType === 'stock' ? 'stock' : 'crypto';
    const key = `${instrumentType}:${symbol}`;
    const current = assetMap.get(key) ?? {
      key,
      symbol,
      name: holding.name,
      instrumentType,
      value: 0,
      exposureValue: 0,
      positionCount: 0,
      hasSpot: false,
      hasPerp: false,
      color: holding.color,
    };
    current.value += holding.value;
    current.exposureValue += holding.exposureValue;
    current.positionCount += 1;
    current.hasSpot ||= holding.positionKind === 'spot';
    current.hasPerp ||= holding.positionKind === 'perp';
    assetMap.set(key, current);
  }
  const assetData = Array.from(assetMap.values())
    .map((asset) => ({
      ...asset,
      kind:
        asset.instrumentType === 'stock'
          ? 'stock'
          : asset.hasSpot && asset.hasPerp
            ? 'spot + perp'
            : asset.hasPerp
              ? 'perp'
              : 'spot',
      allocation: totalValue ? (asset.value / totalValue) * 100 : 0,
      exposureAllocation: grossExposure
        ? (asset.exposureValue / grossExposure) * 100
        : 0,
    }))
    .sort((a, b) => b.exposureValue - a.exposureValue)
    .map((asset, index) => ({
      ...asset,
      color: COLORS[index % COLORS.length],
    }));
  const hhi = assetData.reduce(
    (sum, asset) => sum + Math.pow(asset.exposureAllocation / 100, 2),
    0,
  );
  const diversificationScore =
    assetData.length < 2
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(((1 - hhi) / (1 - 1 / assetData.length)) * 100),
          ),
        );
  const targetPortfolioValue = holdings.reduce(
    (sum, holding) => sum + holding.targetValue,
    0,
  );
  const totalPlannedReward = perps.reduce(
    (sum, holding) => sum + Number(holding.plannedReward ?? 0),
    0,
  );
  const totalPlannedRisk = perps.reduce(
    (sum, holding) => sum + Number(holding.plannedRisk ?? 0),
    0,
  );
  const platformMap = new Map<
    string,
    {
      platform: string;
      value: number;
      spotValue: number;
      perpEquity: number;
      notional: number;
      stakedValue: number;
      count: number;
    }
  >();
  for (const holding of holdings) {
    const platform = holding.platform ?? 'Self custody';
    const current = platformMap.get(platform) ?? {
      platform,
      value: 0,
      spotValue: 0,
      perpEquity: 0,
      notional: 0,
      stakedValue: 0,
      count: 0,
    };
    current.value += holding.value;
    current.count += 1;
    if (holding.positionKind === 'perp') {
      current.perpEquity += holding.value;
      current.notional += holding.notional;
    } else {
      current.spotValue += holding.value;
      if (holding.assetClass && holding.assetClass !== 'spot')
        current.stakedValue += holding.value;
    }
    platformMap.set(platform, current);
  }
  const platformData = Array.from(platformMap.values())
    .sort((a, b) => b.value - a.value)
    .map((item, index) => ({
      ...item,
      allocation: totalValue ? (item.value / totalValue) * 100 : 0,
      color: COLORS[index % COLORS.length],
    }));

  return {
    holdings,
    totalValue,
    dayPnl,
    dayChange: previousTotal ? (dayPnl / previousTotal) * 100 : 0,
    largest: holdings[0] ?? null,
    largestExposure: exposureHoldings[0] ?? null,
    exposureHoldings,
    assetData,
    largestAssetExposure: assetData[0] ?? null,
    dustHoldings,
    dustCount: new Set(dustHoldings.map(holdingAssetKey)).size,
    dustPositionCount: dustHoldings.length,
    dustValue: dustHoldings.reduce((sum, holding) => sum + holding.value, 0),
    savedCount: allBase.length,
    minimumPositionValue: cutoff,
    best:
      [...changed].sort(
        (a, b) => Number(b.change24h) - Number(a.change24h),
      )[0] ?? null,
    totalCost,
    spotUnrealizedPnl: coveredValue - totalCost,
    costCoverage: spotValue ? (coveredValue / spotValue) * 100 : 0,
    diversificationScore,
    stablecoinAllocation: spotValue ? (stablecoinValue / spotValue) * 100 : 0,
    networkCount: networks.size,
    providerCount: providers.size,
    resolvedCount: holdings.filter((holding) =>
      Number.isFinite(holding.price ?? holding.manualPrice),
    ).length,
    lastUpdated: Math.max(
      0,
      ...holdings.map((holding) => holding.updatedAt ?? 0),
    ),
    contributionData: changed.slice(0, 10).map((holding) => ({
      symbol: `${holding.symbol}${holding.positionKind === 'perp' ? ` ${holding.side === 'short' ? 'S' : 'L'}` : ''}`,
      pnl: holding.dayPnl,
      positive: Math.max(holding.dayPnl, 0),
      negative: Math.min(holding.dayPnl, 0),
    })),
    spot,
    stocks,
    cryptoSpot,
    staked,
    perps,
    spotValue,
    stockValue,
    cryptoSpotValue,
    stakedValue: staked.reduce((sum, holding) => sum + holding.value, 0),
    stakingRewardsValue: staked.reduce(
      (sum, holding) => sum + Number(holding.stakingRewardsValue ?? 0),
      0,
    ),
    stakingRewardsKnownCount: staked.filter(
      (holding) => holding.stakingRewardsValue != null,
    ).length,
    perpEquity,
    perpNotional,
    netPerpNotional,
    tradingEquity,
    leverageEquity,
    marginUsed,
    perpPnl,
    grossExposure,
    netExposure,
    effectiveLeverage:
      leverageEquity > 0
        ? perpNotional / leverageEquity
        : perps.length
          ? 100
          : 0,
    netLeverage: leverageEquity > 0 ? netPerpNotional / leverageEquity : 0,
    marginUtilization:
      leverageEquity > 0
        ? (marginUsed / leverageEquity) * 100
        : perps.length
          ? 100
          : 0,
    targetPortfolioValue,
    targetDelta: targetPortfolioValue - totalValue,
    targetsCount: holdings.filter((holding) => holding.targetPrice != null)
      .length,
    stopsCount: perps.filter((holding) => holding.stopLossPrice != null).length,
    nearestLiquidation:
      [...perps]
        .filter((holding) => holding.liquidationDistance != null)
        .sort(
          (a, b) =>
            Number(a.liquidationDistance) - Number(b.liquidationDistance),
        )[0] ?? null,
    totalPlannedReward,
    totalPlannedRisk,
    portfolioRiskReward: totalPlannedRisk
      ? totalPlannedReward / totalPlannedRisk
      : null,
    platformData,
    platformCount: platformData.length,
    largestPlatform: platformData[0] ?? null,
  };
}

export type PortfolioAnalytics = ReturnType<typeof calculateAnalytics>;

export function appendSnapshot(snapshots: PortfolioSnapshot[], value: number) {
  if (!Number.isFinite(value) || value === 0) return snapshots;
  const now = Date.now();
  const recent = repairTransientCompositionSpikes(snapshots).filter(
    (snapshot) => snapshot.timestamp > now - 366 * 86_400_000,
  );
  const last = recent.at(-1);
  if (last && now - last.timestamp < 5 * 60_000)
    return [...recent.slice(0, -1), { timestamp: now, value }].slice(-365);
  return [...recent, { timestamp: now, value }].slice(-365);
}

export function filterSnapshots<T extends PortfolioSnapshot>(
  snapshots: T[],
  range: Range,
  customRange?: CustomHistoryRange | null,
) {
  const durations: Record<PresetRange, number> = {
    '1D': 86_400_000,
    '1W': 7 * 86_400_000,
    '1M': 30 * 86_400_000,
    '1Y': 365 * 86_400_000,
    ALL: Infinity,
  };
  const ordered = Array.from(
    new Map(
      snapshots
        .filter(
          (snapshot) =>
            Number.isFinite(snapshot.timestamp) &&
            Number.isFinite(snapshot.value),
        )
        .sort((left, right) => left.timestamp - right.timestamp)
        .map((snapshot) => [snapshot.timestamp, snapshot]),
    ).values(),
  );
  const validCustomRange =
    range === 'CUSTOM' &&
    customRange &&
    Number.isFinite(customRange.start) &&
    Number.isFinite(customRange.end) &&
    customRange.start <= customRange.end
      ? customRange
      : null;
  const cutoff =
    range === 'CUSTOM'
      ? Date.now() - durations['1M']
      : Date.now() - durations[range];
  const filtered = validCustomRange
    ? ordered.filter(
        (snapshot) =>
          snapshot.timestamp >= validCustomRange.start &&
          snapshot.timestamp <= validCustomRange.end,
      )
    : range === 'ALL'
      ? ordered
      : ordered.filter((snapshot) => snapshot.timestamp >= cutoff);
  const source = downsampleHistory(filtered, 600);
  return source.map((snapshot) => ({
    ...snapshot,
    label: formatHistoryTimestamp(snapshot.timestamp),
  }));
}

export function formatHistoryTick(
  timestamp: number,
  range: Range,
  customRange?: CustomHistoryRange | null,
) {
  const date = new Date(timestamp);
  const customSpan =
    range === 'CUSTOM' && customRange
      ? customRange.end - customRange.start
      : null;
  if (range === '1D' || (customSpan != null && customSpan <= 2 * 86_400_000))
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  const options: Intl.DateTimeFormatOptions =
    range === '1W'
      ? { weekday: 'short', day: 'numeric' }
      : range === '1M' || (customSpan != null && customSpan <= 60 * 86_400_000)
        ? { month: 'short', day: 'numeric' }
        : range === '1Y' ||
            (customSpan != null && customSpan <= 400 * 86_400_000)
          ? { month: 'short' }
          : { month: 'short', year: '2-digit' };
  return date.toLocaleDateString('en-US', options);
}

export function formatHistoryTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatCompactMoneyAxis(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (absolute >= 1_000_000_000)
    return `${sign}$${(absolute / 1_000_000_000).toFixed(1)}B`;
  if (absolute >= 1_000_000)
    return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(1)}k`;
  return `${sign}$${absolute.toFixed(0)}`;
}

function downsampleHistory<T>(points: T[], maximum: number) {
  if (points.length <= maximum) return points;
  const sampled: T[] = [];
  const step = (points.length - 1) / (maximum - 1);
  for (let index = 0; index < maximum; index += 1)
    sampled.push(points[Math.round(index * step)]);
  return sampled;
}

export function isValidHolding(value: unknown): value is Holding {
  if (!value || typeof value !== 'object') return false;
  const holding = value as Partial<Holding>;
  return (
    typeof holding.id === 'string' &&
    typeof holding.name === 'string' &&
    typeof holding.symbol === 'string' &&
    typeof holding.amount === 'number' &&
    [
      'coingecko',
      'dexscreener',
      'hyperliquid',
      'lighter',
      'yahoo',
      'manual',
    ].includes(holding.source ?? '')
  );
}

export function diversificationLabel(score: number) {
  if (score >= 75) return 'Broadly distributed';
  if (score >= 50) return 'Moderately balanced';
  if (score > 0) return 'Concentrated allocation';
  return 'Add multiple assets';
}

export function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
