import type { ValuedHolding } from '@/lib/analytics';

export type PlatformRiskLevel =
  | 'critical'
  | 'high'
  | 'elevated'
  | 'guarded'
  | 'unlevered';

export type PlatformRiskSummary = {
  platform: string;
  holdings: ValuedHolding[];
  perps: ValuedHolding[];
  equity: number;
  spotValue: number;
  liquidSpotValue: number;
  stakedValue: number;
  stakingRewardsValue: number;
  stakingRewardsQuantity: number;
  stakingRewardBreakdown: Array<{
    symbol: string;
    quantity: number;
    value: number;
  }>;
  stakingRewardsKnownCount: number;
  stakedPnl: number;
  stakedPnlKnownCount: number;
  perpEquity: number;
  tradingEquity: number;
  leverageEquity: number;
  perpNotional: number;
  longNotional: number;
  shortNotional: number;
  netPerpNotional: number;
  grossExposure: number;
  netExposure: number;
  marginUsed: number;
  availableTradingEquity: number;
  maintenanceRequirement: number;
  maintenanceBuffer: number;
  maintenanceRatio: number;
  marginUtilization: number;
  effectiveLeverage: number;
  grossLeverage: number;
  netLeverage: number;
  perpToSpotRatio: number | null;
  perpUnrealizedPnl: number;
  knownSpotPnl: number;
  knownSpotPnlCount: number;
  livePnl: number;
  dayPnl: number;
  returnOnMargin: number | null;
  longCount: number;
  shortCount: number;
  crossCount: number;
  isolatedCount: number;
  accountCount: number;
  stopCoverage: number;
  liquidationCoverage: number;
  nearestLiquidation: ValuedHolding | null;
  averageLiquidationDistance: number | null;
  riskScore: number;
  riskLevel: PlatformRiskLevel;
  stressedEquity: number;
  stressedTradingEquity: number;
  stressDelta: number;
  shockedLiquidations: ValuedHolding[];
  accountMaintenanceBreach: boolean;
};

export function calculatePlatformRisks(
  holdings: ValuedHolding[],
  shockPercent: number,
) {
  const byPlatform = new Map<string, ValuedHolding[]>();
  for (const holding of holdings) {
    const platform = holding.platform?.trim() || 'Self custody';
    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), holding]);
  }

  return Array.from(byPlatform, ([platform, platformHoldings]) =>
    calculatePlatformRisk(platform, platformHoldings, shockPercent),
  ).sort(
    (left, right) =>
      right.riskScore - left.riskScore || right.equity - left.equity,
  );
}

function calculatePlatformRisk(
  platform: string,
  holdings: ValuedHolding[],
  shockPercent: number,
): PlatformRiskSummary {
  const perps = holdings.filter((holding) => holding.positionKind === 'perp');
  const spot = holdings.filter((holding) => holding.positionKind === 'spot');
  const staked = spot.filter(
    (holding) =>
      holding.assetClass === 'staked' ||
      holding.assetClass === 'staking' ||
      holding.assetClass === 'unstaking',
  );
  const liquidSpot = spot.filter((holding) => !staked.includes(holding));
  const collateralSpot = liquidSpot.filter(
    (holding) => holding.collateralEligible !== false,
  );
  const equity = holdings.reduce((sum, holding) => sum + holding.value, 0);
  const spotValue = spot.reduce((sum, holding) => sum + holding.value, 0);
  const liquidSpotValue = liquidSpot.reduce(
    (sum, holding) => sum + holding.value,
    0,
  );
  const stakedValue = staked.reduce((sum, holding) => sum + holding.value, 0);
  const stakingRewardsValue = staked.reduce(
    (sum, holding) => sum + Number(holding.stakingRewardsValue ?? 0),
    0,
  );
  const stakingRewardsQuantity = staked.reduce(
    (sum, holding) => sum + Number(holding.stakingRewardsQuantity ?? 0),
    0,
  );
  const stakingRewardMap = new Map<
    string,
    { symbol: string; quantity: number; value: number }
  >();
  for (const holding of staked) {
    if (holding.stakingRewardsQuantity == null) continue;
    const symbol = holding.symbol.toUpperCase();
    const current = stakingRewardMap.get(symbol) ?? {
      symbol,
      quantity: 0,
      value: 0,
    };
    current.quantity += holding.stakingRewardsQuantity;
    current.value += Number(holding.stakingRewardsValue ?? 0);
    stakingRewardMap.set(symbol, current);
  }
  const stakingRewardBreakdown = Array.from(stakingRewardMap.values()).sort(
    (left, right) => right.value - left.value,
  );
  const stakingRewardsKnownCount = staked.filter(
    (holding) => holding.stakingRewardsValue != null,
  ).length;
  const stakedWithPnl = staked.filter(
    (holding) => holding.unrealizedPnl != null,
  );
  const stakedPnl = stakedWithPnl.reduce(
    (sum, holding) => sum + Number(holding.unrealizedPnl),
    0,
  );
  const perpEquity = perps.reduce((sum, holding) => sum + holding.value, 0);
  const tradingEquity =
    collateralSpot.reduce((sum, holding) => sum + holding.value, 0) +
    perpEquity;
  const leverageEquity = perps.reduce(
    (sum, holding) => sum + holding.leverageEquity,
    0,
  );
  const perpNotional = perps.reduce(
    (sum, holding) => sum + holding.notional,
    0,
  );
  const longNotional = perps
    .filter((holding) => holding.side !== 'short')
    .reduce((sum, holding) => sum + holding.notional, 0);
  const shortNotional = perps
    .filter((holding) => holding.side === 'short')
    .reduce((sum, holding) => sum + holding.notional, 0);
  const netPerpNotional = longNotional - shortNotional;
  const marginUsed = perps.reduce((sum, holding) => sum + holding.margin, 0);
  const maintenanceRequirement = perps.reduce(
    (sum, holding) =>
      sum +
      holding.notional * (Number(holding.maintenanceMarginRate ?? 0.5) / 100),
    0,
  );
  const liquidations = perps.filter(
    (holding) =>
      holding.liquidationPrice != null &&
      Number.isFinite(holding.liquidationDistance),
  );
  const nearestLiquidation =
    [...liquidations].sort(
      (left, right) =>
        Number(left.liquidationDistance) - Number(right.liquidationDistance),
    )[0] ?? null;
  const liquidationWeight = liquidations.reduce(
    (sum, holding) => sum + holding.notional,
    0,
  );
  const averageLiquidationDistance = liquidationWeight
    ? liquidations.reduce(
        (sum, holding) =>
          sum + Number(holding.liquidationDistance) * holding.notional,
        0,
      ) / liquidationWeight
    : null;
  const marginUtilization =
    leverageEquity > 0
      ? (marginUsed / leverageEquity) * 100
      : perps.length
        ? 100
        : 0;
  const maintenanceRatio =
    leverageEquity > 0
      ? (maintenanceRequirement / leverageEquity) * 100
      : perps.length
        ? 100
        : 0;
  const grossLeverage =
    leverageEquity > 0 ? perpNotional / leverageEquity : perps.length ? 100 : 0;
  const netLeverage =
    leverageEquity > 0 ? netPerpNotional / leverageEquity : 0;
  const perpUnrealizedPnl = perps.reduce(
    (sum, holding) => sum + Number(holding.unrealizedPnl ?? 0),
    0,
  );
  const spotWithPnl = liquidSpot.filter(
    (holding) => holding.unrealizedPnl != null,
  );
  const knownSpotPnl = spotWithPnl.reduce(
    (sum, holding) => sum + Number(holding.unrealizedPnl),
    0,
  );
  const dayPnl = holdings.reduce((sum, holding) => sum + holding.dayPnl, 0);
  const stopCoverage = perps.length
    ? (perps.filter((holding) => holding.stopLossPrice != null).length /
        perps.length) *
      100
    : 100;
  const liquidationCoverage = perps.length
    ? (liquidations.length / perps.length) * 100
    : 100;
  const crossCount = perps.filter(
    (holding) => holding.marginMode === 'cross',
  ).length;
  const isolatedCount = perps.filter(
    (holding) => holding.marginMode === 'isolated',
  ).length;
  const accountCount = new Set(
    holdings.map((holding) => holding.accountLabel).filter(Boolean),
  ).size;
  const riskScore = calculateRiskScore({
    perps,
    nearestDistance: nearestLiquidation?.liquidationDistance ?? null,
    marginUtilization,
    maintenanceRatio,
    effectiveLeverage: grossLeverage,
    stopCoverage,
    liquidationCoverage,
  });
  const move = clamp(shockPercent, -90, 100) / 100;
  const spotDelta = spotValue * move;
  const perpDelta = perps.reduce(
    (sum, holding) =>
      sum + (holding.side === 'short' ? -1 : 1) * holding.notional * move,
    0,
  );
  const stressDelta = spotDelta + perpDelta;
  const stressedEquity = equity + stressDelta;
  const stressedTradingEquity = leverageEquity + perpDelta;
  const shockedLiquidations = perps.filter((holding) => {
    const mark = Number(holding.price ?? holding.manualPrice ?? 0);
    const liquidation = Number(holding.liquidationPrice);
    if (!(mark > 0) || !(liquidation > 0)) return false;
    const shockedMark = mark * (1 + move);
    return holding.side === 'short'
      ? shockedMark >= liquidation
      : shockedMark <= liquidation;
  });

  return {
    platform,
    holdings,
    perps,
    equity,
    spotValue,
    liquidSpotValue,
    stakedValue,
    stakingRewardsValue,
    stakingRewardsQuantity,
    stakingRewardBreakdown,
    stakingRewardsKnownCount,
    stakedPnl,
    stakedPnlKnownCount: stakedWithPnl.length,
    perpEquity,
    tradingEquity,
    leverageEquity,
    perpNotional,
    longNotional,
    shortNotional,
    netPerpNotional,
    grossExposure: spotValue + perpNotional,
    netExposure: spotValue + netPerpNotional,
    marginUsed,
    availableTradingEquity: Math.max(0, leverageEquity - marginUsed),
    maintenanceRequirement,
    maintenanceBuffer: leverageEquity - maintenanceRequirement,
    maintenanceRatio,
    marginUtilization,
    effectiveLeverage: grossLeverage,
    grossLeverage,
    netLeverage,
    perpToSpotRatio:
      liquidSpotValue > 0
        ? perpNotional / liquidSpotValue
        : perps.length
          ? null
          : 0,
    perpUnrealizedPnl,
    knownSpotPnl,
    knownSpotPnlCount: spotWithPnl.length,
    livePnl: perpUnrealizedPnl + knownSpotPnl + stakedPnl,
    dayPnl,
    returnOnMargin: marginUsed ? (perpUnrealizedPnl / marginUsed) * 100 : null,
    longCount: perps.filter((holding) => holding.side !== 'short').length,
    shortCount: perps.filter((holding) => holding.side === 'short').length,
    crossCount,
    isolatedCount,
    accountCount,
    stopCoverage,
    liquidationCoverage,
    nearestLiquidation,
    averageLiquidationDistance,
    riskScore,
    riskLevel: riskLevel(riskScore, perps.length),
    stressedEquity,
    stressedTradingEquity,
    stressDelta,
    shockedLiquidations,
    accountMaintenanceBreach:
      perps.length > 0 && stressedTradingEquity <= maintenanceRequirement,
  };
}

function calculateRiskScore({
  perps,
  nearestDistance,
  marginUtilization,
  maintenanceRatio,
  effectiveLeverage,
  stopCoverage,
  liquidationCoverage,
}: {
  perps: ValuedHolding[];
  nearestDistance: number | null;
  marginUtilization: number;
  maintenanceRatio: number;
  effectiveLeverage: number;
  stopCoverage: number;
  liquidationCoverage: number;
}) {
  if (!perps.length) return 0;
  const distanceRisk =
    nearestDistance == null ? 45 : clamp(105 - nearestDistance * 2.5, 0, 100);
  const utilizationRisk = clamp(marginUtilization * 1.15, 0, 100);
  const maintenanceRisk = clamp(maintenanceRatio * 2.5, 0, 100);
  const leverageRisk = clamp(((effectiveLeverage - 1) / 9) * 100, 0, 100);
  const missingDataPenalty = (100 - liquidationCoverage) * 0.12;
  const protectionRisk = 100 - stopCoverage;
  return Math.round(
    clamp(
      distanceRisk * 0.46 +
        utilizationRisk * 0.16 +
        maintenanceRisk * 0.12 +
        leverageRisk * 0.16 +
        protectionRisk * 0.1 +
        missingDataPenalty,
      0,
      100,
    ),
  );
}

function riskLevel(score: number, perpCount: number): PlatformRiskLevel {
  if (!perpCount) return 'unlevered';
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 35) return 'elevated';
  return 'guarded';
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}
