'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Coins,
  Crosshair,
  Gauge,
  Layers3,
  Plus,
  Scale,
  ShieldAlert,
} from 'lucide-react';

import {
  AssetIdentity,
  EmptyState,
  MetricCard,
  PageIntro,
  Panel,
  PanelHeader,
} from '@/components/page-primitives';
import { usePortfolio } from '@/components/portfolio-provider';
import { Button } from '@/components/ui/button';
import { calculateAnalytics } from '@/lib/analytics';
import {
  calculatePlatformRisks,
  type PlatformRiskLevel,
  type PlatformRiskSummary,
} from '@/lib/platform-risk';
import { formatMoney } from '@/lib/portfolio';

type ViewFilter = 'all' | 'leveraged' | 'attention';
type SortMode = 'risk' | 'equity' | 'notional' | 'leverage' | 'pnl';

export default function PlatformRiskPage() {
  const { portfolio, openAdd, openEdit } = usePortfolio();
  const [shock, setShock] = useState(-10);
  const [filter, setFilter] = useState<ViewFilter>('all');
  const [sort, setSort] = useState<SortMode>('risk');
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const privacy = portfolio.privacyMode;

  const allHoldings = useMemo(
    () => calculateAnalytics(portfolio.holdings, 0).holdings,
    [portfolio.holdings],
  );
  const platformRisks = useMemo(
    () => calculatePlatformRisks(allHoldings, shock),
    [allHoldings, shock],
  );
  const visiblePlatforms = useMemo(() => {
    const filtered = platformRisks.filter((platform) => {
      if (filter === 'leveraged') return platform.perps.length > 0;
      if (filter === 'attention') return platform.riskScore >= 35;
      return true;
    });
    return [...filtered].sort((left, right) => {
      if (sort === 'equity') return right.equity - left.equity;
      if (sort === 'notional') return right.perpNotional - left.perpNotional;
      if (sort === 'leverage') return right.grossLeverage - left.grossLeverage;
      if (sort === 'pnl') return right.livePnl - left.livePnl;
      return right.riskScore - left.riskScore;
    });
  }, [filter, platformRisks, sort]);
  const activePlatform =
    visiblePlatforms.find((item) => item.platform === selectedPlatform) ??
    visiblePlatforms[0] ??
    platformRisks[0] ??
    null;
  const leveragedPlatforms = platformRisks.filter(
    (platform) => platform.perps.length > 0,
  );
  const totalNotional = leveragedPlatforms.reduce(
    (sum, platform) => sum + platform.perpNotional,
    0,
  );
  const totalTradingEquity = leveragedPlatforms.reduce(
    (sum, platform) => sum + platform.tradingEquity,
    0,
  );
  const totalNetNotional = leveragedPlatforms.reduce(
    (sum, platform) => sum + platform.netPerpNotional,
    0,
  );
  const aggregateGrossLeverage = totalTradingEquity
    ? totalNotional / totalTradingEquity
    : 0;
  const aggregateNetLeverage = totalTradingEquity
    ? totalNetNotional / totalTradingEquity
    : 0;
  const totalLivePnl = platformRisks.reduce(
    (sum, platform) => sum + platform.livePnl,
    0,
  );
  const totalStaked = platformRisks.reduce(
    (sum, platform) => sum + platform.stakedValue,
    0,
  );
  const totalStakingRewards = platformRisks.reduce(
    (sum, platform) => sum + platform.stakingRewardsValue,
    0,
  );
  const stakingRewardsKnownCount = platformRisks.reduce(
    (sum, platform) => sum + platform.stakingRewardsKnownCount,
    0,
  );
  const weightedRisk = totalNotional
    ? Math.round(
        leveragedPlatforms.reduce(
          (sum, platform) => sum + platform.riskScore * platform.perpNotional,
          0,
        ) / totalNotional,
      )
    : 0;
  const nearestLiquidation = platformRisks
    .flatMap((platform) =>
      platform.nearestLiquidation
        ? [
            {
              platform: platform.platform,
              holding: platform.nearestLiquidation,
            },
          ]
        : [],
    )
    .sort(
      (left, right) =>
        Number(left.holding.liquidationDistance) -
        Number(right.holding.liquidationDistance),
    )[0];
  const totalPerps = leveragedPlatforms.reduce(
    (sum, platform) => sum + platform.perps.length,
    0,
  );
  const coveredPerps = leveragedPlatforms.reduce(
    (sum, platform) =>
      sum +
      platform.perps.filter((holding) => holding.liquidationPrice != null)
        .length,
    0,
  );

  return (
    <>
      <PageIntro
        eyebrow="Venue intelligence"
        title="Platform liquidation risk"
        description="Compare collateral, leverage, maintenance buffer and liquidation distance across every venue in one account-aware risk surface."
        actions={
          <Button
            onClick={() => openAdd('perp')}
            className="h-9 rounded-xl bg-primary text-[10px] text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-3.5" /> Enter perpetual
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Building2}
          label="Leveraged platforms"
          value={`${leveragedPlatforms.length}`}
          detail={`${platformRisks.length} total venue${platformRisks.length === 1 ? '' : 's'}`}
          tone="accent"
        />
        <MetricCard
          icon={Gauge}
          label="Gross perp leverage"
          value={`${aggregateGrossLeverage.toFixed(2)}×`}
          detail="Gross notional ÷ trading equity"
          tone={aggregateGrossLeverage >= 5 ? 'negative' : 'default'}
        />
        <MetricCard
          icon={Scale}
          label="Net perp leverage"
          value={signedMultiple(aggregateNetLeverage)}
          detail={`${totalNetNotional >= 0 ? 'Net long' : 'Net short'} exposure`}
        />
        <MetricCard
          icon={Activity}
          label="Open position P&L"
          value={privacy ? '••••' : signedMoney(totalLivePnl)}
          detail="Perps plus spot with known cost basis"
          tone={totalLivePnl >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          icon={Coins}
          label="Staked assets"
          value={privacy ? '••••' : formatMoney(totalStaked, true)}
          detail="Excluded from margin and leverage"
        />
        <MetricCard
          icon={ArrowUpRight}
          label="All-time staking rewards"
          value={
            stakingRewardsKnownCount
              ? privacy
                ? '••••'
                : signedMoney(totalStakingRewards)
              : 'Not available'
          }
          detail={`${stakingRewardsKnownCount} venue-reported or principal-derived balance${stakingRewardsKnownCount === 1 ? '' : 's'}`}
          tone={totalStakingRewards >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          icon={Crosshair}
          label="Nearest liquidation"
          value={
            nearestLiquidation
              ? `${Number(nearestLiquidation.holding.liquidationDistance).toFixed(1)}%`
              : 'Not available'
          }
          detail={
            nearestLiquidation
              ? `${nearestLiquidation.holding.symbol} on ${nearestLiquidation.platform}`
              : 'No reported or estimated levels'
          }
          tone={
            nearestLiquidation &&
            Number(nearestLiquidation.holding.liquidationDistance) < 15
              ? 'negative'
              : 'default'
          }
        />
        <MetricCard
          icon={ShieldAlert}
          label="Weighted risk score"
          value={`${weightedRisk}/100`}
          detail={`${coveredPerps}/${totalPerps} liquidation levels known`}
          tone={weightedRisk >= 60 ? 'negative' : 'default'}
        />
      </section>

      <Panel className="mt-3 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-1 rounded-xl border border-border bg-muted p-1">
            {(['all', 'leveraged', 'attention'] as ViewFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={`rounded-lg px-3 py-1.5 text-[10px] font-medium capitalize transition ${filter === item ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">
              {visiblePlatforms.length} platform
              {visiblePlatforms.length === 1 ? '' : 's'} shown
            </span>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
              aria-label="Sort platform risk"
              className="h-9 rounded-xl border border-input bg-card px-3 text-[10px] text-foreground outline-none focus:border-ring"
            >
              <option value="risk">Sort: liquidation risk</option>
              <option value="equity">Sort: platform equity</option>
              <option value="notional">Sort: perp notional</option>
              <option value="leverage">Sort: gross leverage</option>
              <option value="pnl">Sort: open P&amp;L</option>
            </select>
          </div>
        </div>

        {visiblePlatforms.length ? (
          <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
            {visiblePlatforms.map((platform) => (
              <PlatformCard
                key={platform.platform}
                platform={platform}
                active={activePlatform?.platform === platform.platform}
                privacy={privacy}
                onSelect={() => setSelectedPlatform(platform.platform)}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Building2}
            title="No platforms match this filter"
            description="Choose All platforms or add a perpetual position to activate venue risk analytics."
          />
        )}
      </Panel>

      {activePlatform && (
        <>
          <Panel className="mt-3 overflow-hidden">
            <PanelHeader
              title={`${activePlatform.platform} capital and exposure`}
              description="Trading equity excludes staked and unstaking assets from every margin and leverage denominator"
              aside={
                <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                  {activePlatform.longCount} long · {activePlatform.shortCount}{' '}
                  short
                </span>
              }
            />
            <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              <VenueMetric
                label="Total equity"
                value={
                  privacy ? '••••' : formatMoney(activePlatform.equity, true)
                }
                detail="All venue assets"
              />
              <VenueMetric
                label="Trading equity"
                value={
                  privacy
                    ? '••••'
                    : formatMoney(activePlatform.tradingEquity, true)
                }
                detail="Liquid spot + perp equity"
              />
              <VenueMetric
                label="Liquid spot"
                value={
                  privacy
                    ? '••••'
                    : formatMoney(activePlatform.liquidSpotValue, true)
                }
                detail="Available spot balances"
              />
              <VenueMetric
                label="Staked assets"
                value={
                  privacy
                    ? '••••'
                    : formatMoney(activePlatform.stakedValue, true)
                }
                detail="Not counted as margin"
                tone="muted"
              />
              <VenueMetric
                label="All-time staking rewards"
                value={
                  activePlatform.stakingRewardsKnownCount
                    ? privacy
                      ? '••••'
                      : signedMoney(activePlatform.stakingRewardsValue)
                    : '—'
                }
                detail={
                  activePlatform.stakingRewardsKnownCount
                    ? `${activePlatform.stakingRewardsKnownCount} reported or principal-derived balance${activePlatform.stakingRewardsKnownCount === 1 ? '' : 's'}`
                    : 'Venue reward basis unavailable'
                }
                tone="positive"
              />
              <VenueMetric
                label="Gross perp notional"
                value={
                  privacy
                    ? '••••'
                    : formatMoney(activePlatform.perpNotional, true)
                }
                detail="Long + short notional"
              />
              <VenueMetric
                label="Long notional"
                value={
                  privacy
                    ? '••••'
                    : formatMoney(activePlatform.longNotional, true)
                }
                detail={`${activePlatform.longCount} position${activePlatform.longCount === 1 ? '' : 's'}`}
                tone="positive"
              />
              <VenueMetric
                label="Short notional"
                value={
                  privacy
                    ? '••••'
                    : formatMoney(activePlatform.shortNotional, true)
                }
                detail={`${activePlatform.shortCount} position${activePlatform.shortCount === 1 ? '' : 's'}`}
                tone="negative"
              />
              <VenueMetric
                label="Net perp notional"
                value={
                  privacy ? '••••' : signedMoney(activePlatform.netPerpNotional)
                }
                detail={
                  activePlatform.netPerpNotional >= 0 ? 'Net long' : 'Net short'
                }
              />
              <VenueMetric
                label="Gross leverage"
                value={`${activePlatform.grossLeverage.toFixed(2)}×`}
                detail="Gross notional ÷ trading equity"
                tone={
                  activePlatform.grossLeverage >= 5 ? 'negative' : 'default'
                }
              />
              <VenueMetric
                label="Net leverage"
                value={signedMultiple(activePlatform.netLeverage)}
                detail="Net notional ÷ trading equity"
              />
              <VenueMetric
                label="Perp / liquid spot"
                value={
                  activePlatform.perpToSpotRatio == null
                    ? 'No liquid spot'
                    : `${activePlatform.perpToSpotRatio.toFixed(2)}×`
                }
                detail="Gross notional ÷ liquid spot"
              />
              <VenueMetric
                label="Margin used"
                value={
                  privacy
                    ? '••••'
                    : formatMoney(activePlatform.marginUsed, true)
                }
                detail={`${activePlatform.marginUtilization.toFixed(1)}% of trading equity`}
              />
              <VenueMetric
                label="Free trading equity"
                value={
                  privacy
                    ? '••••'
                    : formatMoney(activePlatform.availableTradingEquity, true)
                }
                detail="Trading equity less margin"
              />
              <VenueMetric
                label="Perp open P&L"
                value={
                  privacy
                    ? '••••'
                    : signedMoney(activePlatform.perpUnrealizedPnl)
                }
                detail={`${activePlatform.perps.filter((holding) => holding.reportedUnrealizedPnl != null).length}/${activePlatform.perps.length} venue-based · rest entry estimate`}
                tone={
                  activePlatform.perpUnrealizedPnl >= 0
                    ? 'positive'
                    : 'negative'
                }
              />
              <VenueMetric
                label="Known spot P&L"
                value={
                  activePlatform.knownSpotPnlCount
                    ? privacy
                      ? '••••'
                      : signedMoney(activePlatform.knownSpotPnl)
                    : '—'
                }
                detail={`${activePlatform.knownSpotPnlCount} cost-basis position${activePlatform.knownSpotPnlCount === 1 ? '' : 's'}`}
                tone={
                  activePlatform.knownSpotPnl >= 0 ? 'positive' : 'negative'
                }
              />
              <VenueMetric
                label="Total open P&L"
                value={privacy ? '••••' : signedMoney(activePlatform.livePnl)}
                detail="Perp + known spot unrealized"
                tone={activePlatform.livePnl >= 0 ? 'positive' : 'negative'}
              />
              <VenueMetric
                label="24h P&L"
                value={privacy ? '••••' : signedMoney(activePlatform.dayPnl)}
                detail="Marked position change"
                tone={activePlatform.dayPnl >= 0 ? 'positive' : 'negative'}
              />
              <VenueMetric
                label="Perp return on margin"
                value={
                  activePlatform.returnOnMargin == null
                    ? '—'
                    : signedPercent(activePlatform.returnOnMargin, 1)
                }
                detail="Open perp P&L ÷ margin used"
                tone={
                  Number(activePlatform.returnOnMargin) >= 0
                    ? 'positive'
                    : 'negative'
                }
              />
            </div>
          </Panel>

          <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,.6fr)]">
            <Panel className="overflow-hidden">
              <PanelHeader
                title={`${activePlatform.platform} liquidation map`}
                description="Live mark-to-liquidation distance for every perpetual on this venue"
                aside={
                  <RiskBadge
                    level={activePlatform.riskLevel}
                    score={activePlatform.riskScore}
                  />
                }
              />
              {activePlatform.perps.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] text-left">
                    <thead className="border-b border-border text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                      <tr>
                        <th className="px-5 py-3 font-medium">Position</th>
                        <th className="px-3 py-3 text-right font-medium">
                          Mark
                        </th>
                        <th className="px-3 py-3 text-right font-medium">
                          Liquidation
                        </th>
                        <th className="px-3 py-3 text-right font-medium">
                          Distance
                        </th>
                        <th className="px-3 py-3 text-right font-medium">
                          Margin
                        </th>
                        <th className="px-3 py-3 text-right font-medium">
                          Open P&amp;L
                        </th>
                        <th className="px-5 py-3 text-right font-medium">
                          Protection
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...activePlatform.perps]
                        .sort(
                          (left, right) =>
                            Number(left.liquidationDistance ?? Infinity) -
                            Number(right.liquidationDistance ?? Infinity),
                        )
                        .map((holding) => {
                          const distance = Number(holding.liquidationDistance);
                          const stressHit =
                            activePlatform.shockedLiquidations.some(
                              (item) => item.id === holding.id,
                            );
                          return (
                            <tr
                              key={holding.id}
                              onClick={() => openEdit(holding)}
                              className="cursor-pointer border-b border-border transition last:border-0 hover:bg-muted/50"
                            >
                              <td className="px-5 py-3.5">
                                <AssetIdentity holding={holding} compact />
                              </td>
                              <RiskTableValue
                                value={
                                  privacy
                                    ? '••••'
                                    : formatMoney(
                                        Number(
                                          holding.price ?? holding.manualPrice,
                                        ),
                                      )
                                }
                                detail={`${holding.side ?? 'long'} · ${formatLeverage(holding.leverage)}`}
                              />
                              <RiskTableValue
                                value={
                                  privacy
                                    ? '••••'
                                    : holding.liquidationPrice != null
                                      ? formatMoney(holding.liquidationPrice)
                                      : 'Account-level'
                                }
                                detail={
                                  holding.reportedLiquidationPrice
                                    ? 'Venue reported'
                                    : holding.liquidationPrice != null
                                      ? 'Model estimate'
                                      : 'No position level'
                                }
                              />
                              <RiskTableValue
                                value={
                                  Number.isFinite(distance)
                                    ? `${distance.toFixed(1)}%`
                                    : 'Unknown'
                                }
                                detail={
                                  stressHit
                                    ? `Hit at ${signedPercent(shock)}`
                                    : 'From current mark'
                                }
                                tone={
                                  stressHit ||
                                  (Number.isFinite(distance) && distance < 15)
                                    ? 'negative'
                                    : Number.isFinite(distance) && distance < 30
                                      ? 'warning'
                                      : 'default'
                                }
                              />
                              <RiskTableValue
                                value={
                                  privacy
                                    ? '••••'
                                    : formatMoney(holding.margin, true)
                                }
                                detail={`${holding.marginMode ?? 'cross'} · ${holding.accountLabel ?? 'Main account'}`}
                              />
                              <RiskTableValue
                                value={
                                  privacy
                                    ? '••••'
                                    : signedMoney(
                                        Number(holding.unrealizedPnl ?? 0),
                                      )
                                }
                                detail={
                                  holding.reportedUnrealizedPnl != null
                                    ? Number.isFinite(Number(holding.roe))
                                      ? `Venue basis · ${signedPercent(Number(holding.roe), 1)} ROE`
                                      : 'Venue-reported basis'
                                    : Number.isFinite(Number(holding.roe))
                                      ? `Entry estimate · ${signedPercent(Number(holding.roe), 1)} ROE`
                                      : 'Live mark vs entry'
                                }
                                tone={
                                  Number(holding.unrealizedPnl ?? 0) >= 0
                                    ? 'positive'
                                    : 'negative'
                                }
                              />
                              <RiskTableValue
                                value={
                                  holding.stopLossPrice ? 'Stop set' : 'No stop'
                                }
                                detail={
                                  holding.stopLossPrice && !privacy
                                    ? `At ${formatMoney(holding.stopLossPrice)}`
                                    : holding.marginMode === 'cross'
                                      ? 'Account-coupled'
                                      : 'Position collateral'
                                }
                                tone={
                                  holding.stopLossPrice ? 'positive' : 'warning'
                                }
                                last
                              />
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={Gauge}
                  title="No liquidation exposure on this platform"
                  description="This venue currently contains spot, stock or staking balances only."
                  action={
                    <Button
                      onClick={() => openAdd('perp')}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      <Plus className="size-3.5" /> Add perpetual
                    </Button>
                  }
                />
              )}
            </Panel>

            <div className="space-y-3">
              <Panel className="overflow-hidden">
                <PanelHeader
                  title="Venue health"
                  description="Drivers behind the relative risk score"
                />
                <div className="space-y-4 p-5">
                  {activePlatform.stakedValue > 0 && (
                    <div className="flex items-start gap-2 rounded-xl border border-border bg-accent/60 px-3 py-2.5">
                      <Coins className="mt-0.5 size-3 shrink-0 text-accent-foreground" />
                      <p className="text-[10px] leading-4 text-muted-foreground">
                        {privacy
                          ? 'Staked assets are excluded from all margin ratios.'
                          : `${formatMoney(activePlatform.stakedValue, true)} staked is equity, not margin, and is excluded from leverage ratios.`}
                      </p>
                    </div>
                  )}
                  <HealthMeter
                    label="Margin utilization"
                    value={activePlatform.marginUtilization}
                    display={`${activePlatform.marginUtilization.toFixed(1)}%`}
                  />
                  <HealthMeter
                    label="Maintenance / trading equity"
                    value={Math.min(100, activePlatform.maintenanceRatio * 2.5)}
                    display={`${activePlatform.maintenanceRatio.toFixed(1)}%`}
                  />
                  <HealthMeter
                    label="Stop-loss coverage"
                    value={100 - activePlatform.stopCoverage}
                    display={`${activePlatform.stopCoverage.toFixed(0)}% covered`}
                    inverse
                  />
                  <HealthMeter
                    label="Liquidation data coverage"
                    value={100 - activePlatform.liquidationCoverage}
                    display={`${activePlatform.liquidationCoverage.toFixed(0)}% known`}
                    inverse
                  />
                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
                    <MiniStat
                      label="Maintenance req."
                      value={
                        privacy
                          ? '••••'
                          : formatMoney(
                              activePlatform.maintenanceRequirement,
                              true,
                            )
                      }
                    />
                    <MiniStat
                      label="Trading buffer"
                      value={
                        privacy
                          ? '••••'
                          : formatMoney(activePlatform.maintenanceBuffer, true)
                      }
                    />
                    <MiniStat
                      label="Margin used"
                      value={
                        privacy
                          ? '••••'
                          : formatMoney(activePlatform.marginUsed, true)
                      }
                    />
                    <MiniStat
                      label="Free trading eq."
                      value={
                        privacy
                          ? '••••'
                          : formatMoney(
                              activePlatform.availableTradingEquity,
                              true,
                            )
                      }
                    />
                    <MiniStat
                      label="Cross / isolated"
                      value={`${activePlatform.crossCount} / ${activePlatform.isolatedCount}`}
                    />
                    <MiniStat
                      label="Accounts"
                      value={String(Math.max(1, activePlatform.accountCount))}
                    />
                  </div>
                </div>
              </Panel>

              <Panel className="overflow-hidden">
                <PanelHeader
                  title="Platform shock"
                  description="Move every asset on this venue together"
                  aside={
                    <span
                      className={`font-mono text-[11px] font-semibold ${shock >= 0 ? 'text-[var(--positive)]' : 'text-destructive'}`}
                    >
                      {signedPercent(shock)}
                    </span>
                  }
                />
                <div className="p-5">
                  <input
                    aria-label="Platform market shock"
                    type="range"
                    min="-50"
                    max="50"
                    step="1"
                    value={shock}
                    onChange={(event) => setShock(Number(event.target.value))}
                    className="stress-slider w-full"
                  />
                  <div className="mt-3 grid grid-cols-5 gap-1">
                    {[-20, -10, 0, 10, 20].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setShock(preset)}
                        className={`rounded-lg py-1.5 font-mono text-[9px] transition ${shock === preset ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                      >
                        {signedPercent(preset)}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <ScenarioStat
                      label="Stressed equity"
                      value={
                        privacy
                          ? '••••'
                          : formatMoney(activePlatform.stressedEquity, true)
                      }
                      tone={
                        activePlatform.stressedEquity >= 0
                          ? 'default'
                          : 'negative'
                      }
                    />
                    <ScenarioStat
                      label="Trading equity"
                      value={
                        privacy
                          ? '••••'
                          : formatMoney(
                              activePlatform.stressedTradingEquity,
                              true,
                            )
                      }
                      tone={
                        activePlatform.stressedTradingEquity >=
                        activePlatform.maintenanceRequirement
                          ? 'default'
                          : 'negative'
                      }
                    />
                    <ScenarioStat
                      label="Equity impact"
                      value={
                        privacy
                          ? '••••'
                          : `${activePlatform.stressDelta >= 0 ? '+' : ''}${formatMoney(activePlatform.stressDelta, true)}`
                      }
                      tone={
                        activePlatform.stressDelta >= 0
                          ? 'positive'
                          : 'negative'
                      }
                    />
                    <ScenarioStat
                      label="Position liqs"
                      value={String(activePlatform.shockedLiquidations.length)}
                      tone={
                        activePlatform.shockedLiquidations.length
                          ? 'negative'
                          : 'positive'
                      }
                    />
                    <ScenarioStat
                      label="Account status"
                      value={
                        activePlatform.accountMaintenanceBreach
                          ? 'Breach'
                          : 'Above maint.'
                      }
                      tone={
                        activePlatform.accountMaintenanceBreach
                          ? 'negative'
                          : 'positive'
                      }
                    />
                  </div>
                </div>
              </Panel>
            </div>
          </section>
        </>
      )}

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Venue comparison"
          description="Equity, notional and liquidation resilience side by side"
          aside={
            <span className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
              Dust included for risk
            </span>
          }
        />
        {visiblePlatforms.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1380px] text-left">
              <thead className="border-b border-border text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Platform</th>
                  <th className="px-3 py-3 text-right font-medium">
                    Total equity
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    Trading equity
                  </th>
                  <th className="px-3 py-3 text-right font-medium">Staked</th>
                  <th className="px-3 py-3 text-right font-medium">
                    Gross notional
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    Net notional
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    Gross lev.
                  </th>
                  <th className="px-3 py-3 text-right font-medium">Net lev.</th>
                  <th className="px-3 py-3 text-right font-medium">
                    Open P&amp;L
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    Margin use
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    Nearest liq.
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    Shock liqs.
                  </th>
                  <th className="px-5 py-3 text-right font-medium">Risk</th>
                </tr>
              </thead>
              <tbody>
                {visiblePlatforms.map((platform) => (
                  <tr
                    key={platform.platform}
                    onClick={() => setSelectedPlatform(platform.platform)}
                    className="cursor-pointer border-b border-border transition last:border-0 hover:bg-muted/50"
                  >
                    <td className="px-5 py-3.5">
                      <p className="text-[11px] font-medium text-foreground">
                        {platform.platform}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {platform.holdings.length} position
                        {platform.holdings.length === 1 ? '' : 's'} ·{' '}
                        {platform.perps.length} perp
                        {platform.perps.length === 1 ? '' : 's'}
                      </p>
                    </td>
                    <ComparisonValue
                      value={
                        privacy ? '••••' : formatMoney(platform.equity, true)
                      }
                    />
                    <ComparisonValue
                      value={
                        privacy
                          ? '••••'
                          : formatMoney(platform.tradingEquity, true)
                      }
                    />
                    <ComparisonValue
                      value={
                        privacy
                          ? '••••'
                          : formatMoney(platform.stakedValue, true)
                      }
                    />
                    <ComparisonValue
                      value={
                        privacy
                          ? '••••'
                          : formatMoney(platform.perpNotional, true)
                      }
                    />
                    <ComparisonValue
                      value={
                        privacy ? '••••' : signedMoney(platform.netPerpNotional)
                      }
                    />
                    <ComparisonValue
                      value={`${platform.grossLeverage.toFixed(2)}×`}
                    />
                    <ComparisonValue
                      value={signedMultiple(platform.netLeverage)}
                    />
                    <ComparisonValue
                      value={privacy ? '••••' : signedMoney(platform.livePnl)}
                      tone={platform.livePnl < 0 ? 'negative' : 'positive'}
                    />
                    <ComparisonValue
                      value={`${platform.marginUtilization.toFixed(1)}%`}
                    />
                    <ComparisonValue
                      value={
                        platform.nearestLiquidation
                          ? `${Number(platform.nearestLiquidation.liquidationDistance).toFixed(1)}%`
                          : platform.perps.length
                            ? 'Account-level'
                            : '—'
                      }
                    />
                    <ComparisonValue
                      value={String(platform.shockedLiquidations.length)}
                      tone={
                        platform.shockedLiquidations.length
                          ? 'negative'
                          : 'default'
                      }
                    />
                    <td className="px-5 py-3.5 text-right">
                      <RiskBadge
                        level={platform.riskLevel}
                        score={platform.riskScore}
                        compact
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Layers3}
            title="No venue data"
            description="Add or import positions to build platform-specific analytics."
          />
        )}
      </Panel>

      <div className="mt-3 flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-700 dark:text-amber-300" />
        <p className="text-[10px] leading-4 text-muted-foreground">
          Risk scores combine liquidation distance, margin utilization,
          maintenance load, gross leverage and stop coverage. Staked and
          unstaking assets remain in total equity but are excluded from margin,
          trading equity and leverage denominators. Scores are comparative
          estimates—not liquidation probabilities. Cross and portfolio-margin
          outcomes can change with collateral, funding, margin tiers, oracle
          marks and other positions on the same account.
        </p>
      </div>
    </>
  );
}

function PlatformCard({
  platform,
  active,
  privacy,
  onSelect,
}: {
  platform: PlatformRiskSummary;
  active: boolean;
  privacy: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`bg-card p-5 text-left text-card-foreground transition hover:bg-muted/50 ${active ? 'ring-1 ring-inset ring-primary/30' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-foreground">
            {platform.platform}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {platform.holdings.length} position
            {platform.holdings.length === 1 ? '' : 's'} ·{' '}
            {platform.accountCount || 1} account
            {platform.accountCount === 1 ? '' : 's'}
          </p>
        </div>
        <RiskBadge
          level={platform.riskLevel}
          score={platform.riskScore}
          compact
        />
      </div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${platform.perps.length ? Math.max(3, platform.riskScore) : 0}%`,
            background: riskColor(platform.riskLevel),
          }}
        />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4">
        <MiniStat
          label="Equity"
          value={privacy ? '••••' : formatMoney(platform.equity, true)}
        />
        <MiniStat
          label="Trading equity"
          value={privacy ? '••••' : formatMoney(platform.tradingEquity, true)}
        />
        <MiniStat
          label="Staked"
          value={privacy ? '••••' : formatMoney(platform.stakedValue, true)}
        />
        <MiniStat
          label="Perp notional"
          value={privacy ? '••••' : formatMoney(platform.perpNotional, true)}
        />
        <MiniStat
          label="Gross / net lev."
          value={`${platform.grossLeverage.toFixed(2)}× / ${signedMultiple(platform.netLeverage)}`}
        />
        <MiniStat
          label="Open P&L"
          value={privacy ? '••••' : signedMoney(platform.livePnl)}
        />
      </div>
    </button>
  );
}

function RiskBadge({
  level,
  score,
  compact = false,
}: {
  level: PlatformRiskLevel;
  score: number;
  compact?: boolean;
}) {
  const label = level === 'unlevered' ? 'No leverage' : `${level} · ${score}`;
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border font-semibold uppercase tracking-[0.1em] ${compact ? 'px-2 py-1 text-[6px]' : 'px-2.5 py-1 text-[7px]'} ${riskClasses(level)}`}
    >
      {label}
    </span>
  );
}

function VenueMetric({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'positive' | 'negative' | 'muted';
}) {
  return (
    <div className="min-w-0 bg-card px-4 py-4">
      <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-2 truncate font-mono text-[13px] font-semibold ${tone === 'positive' ? 'text-[var(--positive)]' : tone === 'negative' ? 'text-destructive' : tone === 'muted' ? 'text-[var(--information)]' : 'text-foreground'}`}
      >
        {value}
      </p>
      <p className="mt-1.5 truncate text-[9px] text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}

function RiskTableValue({
  value,
  detail,
  tone = 'default',
  last = false,
}: {
  value: string;
  detail: string;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
  last?: boolean;
}) {
  return (
    <td className={`${last ? 'px-5' : 'px-3'} py-3.5 text-right`}>
      <p
        className={`font-mono text-[10px] font-medium ${tone === 'positive' ? 'text-[var(--positive)]' : tone === 'negative' ? 'text-destructive' : tone === 'warning' ? 'text-[var(--warning)]' : 'text-foreground'}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[9px] text-muted-foreground">{detail}</p>
    </td>
  );
}

function HealthMeter({
  label,
  value,
  display,
  inverse = false,
}: {
  label: string;
  value: number;
  display: string;
  inverse?: boolean;
}) {
  const normalized = Math.max(0, Math.min(100, value));
  const dangerous = inverse ? normalized > 35 : normalized > 60;
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span
          className={`font-mono text-[10px] ${dangerous ? 'text-destructive' : 'text-foreground'}`}
        >
          {display}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full"
          style={{
            width: `${normalized}%`,
            background: dangerous ? 'var(--destructive)' : 'var(--primary)',
          }}
        />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 truncate font-mono text-[10px] text-foreground">
        {value}
      </p>
    </div>
  );
}

function ScenarioStat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  const Icon =
    tone === 'negative'
      ? ArrowDownRight
      : tone === 'positive'
        ? ArrowUpRight
        : Gauge;
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        <Icon
          className={`size-3 ${tone === 'negative' ? 'text-destructive' : tone === 'positive' ? 'text-[var(--positive)]' : 'text-muted-foreground'}`}
        />
      </div>
      <p
        className={`mt-2 truncate font-mono text-[10px] font-medium ${tone === 'negative' ? 'text-destructive' : tone === 'positive' ? 'text-[var(--positive)]' : 'text-foreground'}`}
      >
        {value}
      </p>
    </div>
  );
}

function ComparisonValue({
  value,
  tone = 'default',
}: {
  value: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  return (
    <td
      className={`px-3 py-3.5 text-right font-mono text-[10px] ${tone === 'negative' ? 'text-destructive' : tone === 'positive' ? 'text-[var(--positive)]' : 'text-foreground'}`}
    >
      {value}
    </td>
  );
}

function signedPercent(value: number, decimals = 0) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

function signedMoney(value: number) {
  const formatted = formatMoney(value, true);
  return value > 0 ? `+${formatted}` : formatted;
}

function signedMultiple(value: number) {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}×`;
}

function formatLeverage(value: number | undefined) {
  const leverage = Math.max(1, Number(value) || 1);
  return `${leverage.toFixed(leverage >= 10 ? 1 : 2).replace(/\.0+$/, '')}×`;
}

function riskColor(level: PlatformRiskLevel) {
  if (level === 'critical' || level === 'high') return 'var(--destructive)';
  if (level === 'elevated') return 'var(--warning)';
  return 'var(--primary)';
}

function riskClasses(level: PlatformRiskLevel) {
  if (level === 'critical')
    return 'border-destructive/30 bg-destructive/10 text-destructive';
  if (level === 'high')
    return 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300';
  if (level === 'elevated')
    return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (level === 'guarded')
    return 'border-primary/25 bg-primary/10 text-primary';
  return 'border-border bg-muted text-muted-foreground';
}
