'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Crosshair,
  Gauge,
  Layers3,
  Plus,
  RefreshCw,
  ShieldAlert,
  WalletCards,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { usePortfolio } from '@/components/portfolio-provider';
import {
  HistoryRangeControl,
  usePersistentHistoryRange,
} from '@/components/history-range-control';
import {
  MetricCard,
  Money,
  PageIntro,
  Panel,
  PanelHeader,
} from '@/components/page-primitives';
import { Button } from '@/components/ui/button';
import { ChartContainer } from '@/components/ui/chart';
import {
  filterSnapshots,
  formatCompactMoneyAxis,
  formatHistoryTick,
} from '@/lib/analytics';
import { formatMoney } from '@/lib/portfolio';
import type { SparklineSeries } from '@/lib/sparklines';
import {
  buildDailyPortfolioPnlHistory,
  buildPortfolioHistory,
  currentUtcDayPnl,
  historySourceLabels,
} from '@/lib/venue-history';

const DAILY_PNL_STABLECOINS = new Set([
  'USDC',
  'USDT',
  'DAI',
  'USDE',
  'USDS',
  'PYUSD',
  'FDUSD',
  'TUSD',
]);

export default function OverviewPage() {
  const [historyMetric, setHistoryMetric] = useState<'equity' | 'pnl'>(
    'equity',
  );
  const [utcDayKey, setUtcDayKey] = useState(() => utcCalendarDay(Date.now()));
  const {
    portfolio,
    analytics,
    importProfiles,
    historyRefreshState,
    openAdd,
    refreshVenueHistories,
  } = usePortfolio();
  const {
    range,
    customRange,
    label: rangeLabel,
    selectPreset,
    selectCustom,
  } = usePersistentHistoryRange();
  const privacy = portfolio.privacyMode;
  const combinedHistory = useMemo(
    () =>
      buildPortfolioHistory(
        portfolio.snapshots,
        portfolio.venueHistories ?? [],
        analytics.totalValue,
      ),
    [analytics.totalValue, portfolio.snapshots, portfolio.venueHistories],
  );
  const history = useMemo(
    () => filterSnapshots(combinedHistory, range, customRange),
    [combinedHistory, customRange, range],
  );
  const combinedPnlHistory = useMemo(() => {
    const baseline = combinedHistory[0]?.value;
    if (combinedHistory.length < 2 || !Number.isFinite(baseline)) return [];
    return combinedHistory.map((point) => ({
      ...point,
      value: point.value - Number(baseline),
    }));
  }, [combinedHistory]);
  const pnlHistory = useMemo(
    () => filterSnapshots(combinedPnlHistory, range, customRange),
    [combinedPnlHistory, customRange, range],
  );
  const combinedDailyPnlHistory = useMemo(
    () => buildDailyPortfolioPnlHistory(combinedPnlHistory),
    [combinedPnlHistory],
  );
  const dailyPnlHistory = useMemo(
    () => filterSnapshots(combinedDailyPnlHistory, range, customRange),
    [combinedDailyPnlHistory, customRange, range],
  );
  const historySources = useMemo(
    () => historySourceLabels(portfolio.venueHistories ?? []),
    [portfolio.venueHistories],
  );
  const primaryHistory = historyMetric === 'equity' ? history : pnlHistory;
  const primaryHistorySources =
    historyMetric === 'equity' ? historySources : ['Whole portfolio'];
  const primaryHistoryColor =
    historyMetric === 'equity' ? 'var(--primary)' : 'var(--information)';
  const canSyncVenueHistory = importProfiles.some(
    (profile) =>
      profile.source === 'hyperliquid' || profile.source === 'lighter',
  );
  const largestAssets = useMemo(
    () => analytics.assetData.slice(0, 5),
    [analytics.assetData],
  );
  const sparklineAssetData = useMemo(() => {
    const assets = new Map<string, (typeof analytics.assetData)[number]>();
    for (const asset of largestAssets) assets.set(asset.key, asset);
    for (const asset of analytics.assetData) {
      if (asset.instrumentType === 'crypto') assets.set(asset.key, asset);
      if (assets.size >= 40) break;
    }
    return Array.from(assets.values()).slice(0, 40);
  }, [analytics.assetData, largestAssets]);
  const sparklineAssets = useMemo(
    () =>
      sparklineAssetData.map((asset) => {
        const matchingHoldings = analytics.holdings.filter(
          (holding) =>
            holding.symbol.toUpperCase() === asset.symbol &&
            (holding.instrumentType === 'stock' ? 'stock' : 'crypto') ===
              asset.instrumentType,
        );
        const identified = matchingHoldings.find((holding) => holding.coinId);
        const marketLinked = matchingHoldings.find(
          (holding) => holding.marketRef,
        );
        const priced = matchingHoldings.find(
          (holding) => Number(holding.price ?? holding.manualPrice) > 0,
        );
        return {
          key: asset.key,
          symbol: asset.symbol,
          instrumentType: asset.instrumentType,
          coinId: identified?.coinId,
          marketRef: marketLinked?.marketRef,
          currentPrice: priced?.price ?? priced?.manualPrice,
          color: asset.color,
        };
      }),
    [analytics.holdings, sparklineAssetData],
  );
  const sparklineRequestKey = JSON.stringify(sparklineAssets);
  const [sparklines, setSparklines] = useState<Record<string, SparklineSeries>>(
    {},
  );
  useEffect(() => {
    const timer = window.setInterval(
      () => setUtcDayKey(utcCalendarDay(Date.now())),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const requestedAssets = JSON.parse(
      sparklineRequestKey,
    ) as typeof sparklineAssets;
    if (!requestedAssets.length) return;
    const controller = new AbortController();
    void fetch('/api/market/sparklines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assets: requestedAssets }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Sparkline history failed');
        return (await response.json()) as {
          sparklines?: Record<string, SparklineSeries>;
        };
      })
      .then((result) => setSparklines(result.sparklines ?? {}))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError'))
          setSparklines({});
      });
    return () => controller.abort();
  }, [sparklineRequestKey, utcDayKey]);
  const dailyCoinPnl = useMemo(() => {
    const rows = sparklineAssets.flatMap((asset) => {
      if (
        asset.instrumentType !== 'crypto' ||
        DAILY_PNL_STABLECOINS.has(asset.symbol.toUpperCase())
      )
        return [];
      const series = sparklines[asset.key];
      const dayOpen = Number(series?.utcDayOpen);
      const canonicalPrice = Number(series?.points.at(-1));
      if (!(dayOpen > 0) || !(canonicalPrice > 0)) return [];
      const matching = analytics.holdings.filter(
        (holding) =>
          holding.instrumentType !== 'stock' &&
          holding.symbol.toUpperCase() === asset.symbol.toUpperCase(),
      );
      const pnl = matching.reduce((sum, holding) => {
        const direction =
          holding.positionKind === 'perp' && holding.side === 'short' ? -1 : 1;
        return sum + direction * holding.amount * (canonicalPrice - dayOpen);
      }, 0);
      const latestPrice = canonicalPrice;
      return [
        {
          key: asset.key,
          symbol: asset.symbol,
          pnl,
          positive: Math.max(0, pnl),
          negative: Math.min(0, pnl),
          dayOpen,
          latestPrice,
          changePercent:
            latestPrice > 0
              ? (latestPrice / dayOpen - 1) * 100
              : series.utcDayChangePercent,
          positionCount: matching.length,
          color: asset.color,
        },
      ];
    });
    const visible = [...rows]
      .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl))
      .slice(0, 10)
      .sort((left, right) => right.pnl - left.pnl);
    return {
      rows: visible,
      total: rows.reduce((sum, row) => sum + row.pnl, 0),
      coverage: rows.length,
      requested: sparklineAssets.filter(
        (asset) =>
          asset.instrumentType === 'crypto' &&
          !DAILY_PNL_STABLECOINS.has(asset.symbol.toUpperCase()),
      ).length,
    };
  }, [analytics.holdings, sparklines, sparklineAssets]);
  const venueTodayPnl = currentUtcDayPnl(combinedDailyPnlHistory);
  const maxPlausibleDailyPnl = Math.max(10_000, analytics.totalValue * 3);
  const safeVenueTodayPnl =
    Math.abs(venueTodayPnl) <= maxPlausibleDailyPnl ? venueTodayPnl : 0;
  const hasCompleteCoinCoverage =
    dailyCoinPnl.coverage > 0 &&
    dailyCoinPnl.coverage === dailyCoinPnl.requested &&
    Math.abs(dailyCoinPnl.total) <= maxPlausibleDailyPnl;
  const todayPnl = hasCompleteCoinCoverage
    ? dailyCoinPnl.total
    : safeVenueTodayPnl;
  const openingEquity = analytics.totalValue - todayPnl;
  const todayChange = openingEquity > 0 ? (todayPnl / openingEquity) * 100 : 0;
  const historyDomain: [number, number] | ['dataMin', 'dataMax'] =
    range === 'CUSTOM' && customRange
      ? [customRange.start, customRange.end]
      : ['dataMin', 'dataMax'];
  const targetChange = analytics.totalValue
    ? (analytics.targetDelta / analytics.totalValue) * 100
    : 0;
  const percentOfPortfolio = (value: number) =>
    analytics.totalValue ? (value / analytics.totalValue) * 100 : 0;
  const portfolioSplit = useMemo(() => {
    const ranked = analytics.assetData
      .filter((asset) => asset.value > 0)
      .sort((a, b) => b.value - a.value)
      .map((asset) => ({
        symbol: asset.symbol,
        kind: asset.kind,
        value: asset.value,
        color: asset.color,
      }));
    const total = ranked.reduce((sum, asset) => sum + asset.value, 0);
    const visible =
      ranked.length > 6
        ? [
            ...ranked.slice(0, 5),
            {
              symbol: 'Other',
              kind: `${ranked.length - 5} assets`,
              value: ranked
                .slice(5)
                .reduce((sum, asset) => sum + asset.value, 0),
              color: '#8e9ba3',
            },
          ]
        : ranked;
    return visible.map((asset) => ({
      ...asset,
      share: total ? (asset.value / total) * 100 : 0,
    }));
  }, [analytics.assetData]);

  return (
    <>
      <PageIntro
        eyebrow="Portfolio"
        title="Overview"
        description="Current crypto and stock value, perpetual equity, market exposure and target scenarios based on live prices."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => openAdd('perp')}
              className="h-9 rounded-lg border-border bg-card px-3 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Gauge className="size-3.5" /> New perp
            </Button>
            <Button
              onClick={() => openAdd('spot')}
              className="h-9 rounded-lg bg-primary px-3 text-[11px] font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="size-3.5" /> Add asset
            </Button>
          </>
        }
      />

      <Panel className="overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,.7fr)]">
          <div className="p-5 sm:p-7 xl:p-8">
            <p className="text-[12px] font-medium text-muted-foreground">
              Total portfolio equity
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <p className="font-mono text-[clamp(2.5rem,5vw,4.8rem)] font-medium leading-none tracking-[-0.07em]">
                {privacy ? '••••••••' : formatMoney(analytics.totalValue)}
              </p>
              {analytics.totalValue !== 0 && (
                <span
                  className={`mb-1.5 flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-semibold sm:mb-2 ${todayChange >= 0 ? 'border-border bg-muted text-[var(--positive)]' : 'border-destructive/20 bg-destructive/10 text-destructive'}`}
                >
                  {todayChange >= 0 ? (
                    <ArrowUpRight className="size-3.5" />
                  ) : (
                    <ArrowDownRight className="size-3.5" />
                  )}
                  {Math.abs(todayChange).toFixed(2)}%
                </span>
              )}
            </div>
            <p className="mt-3 text-[12px] text-muted-foreground">
              <Money value={todayPnl} privacy={privacy} signed /> today since
              00:00 UTC · {analytics.cryptoSpot.length} crypto ·{' '}
              {analytics.stocks.length} stocks · {analytics.perps.length}{' '}
              perpetual
            </p>
            <div className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border xl:grid-cols-4">
              <HeroMetric
                label="Owned assets"
                value={
                  privacy ? '••••' : formatMoney(analytics.spotValue, true)
                }
                detail={`${percentOfPortfolio(analytics.spotValue).toFixed(1)}% of portfolio`}
              />
              <HeroMetric
                label="Perp equity"
                value={
                  privacy ? '••••' : formatMoney(analytics.perpEquity, true)
                }
                detail={`${percentOfPortfolio(analytics.perpEquity).toFixed(1)}% of portfolio`}
              />
              <HeroMetric
                label="Gross exposure"
                value={
                  privacy ? '••••' : formatMoney(analytics.grossExposure, true)
                }
                detail={`${percentOfPortfolio(analytics.grossExposure).toFixed(0)}% of equity`}
              />
              <HeroMetric
                label="Gross perp leverage"
                value={`${analytics.effectiveLeverage.toFixed(2)}×`}
                detail="Perp notional ÷ leverage equity"
              />
            </div>
            <div className="mt-6 rounded-xl border border-border bg-[var(--surface-subtle)] p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-foreground">
                    Portfolio split by asset
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Spot and perpetual equity combine under the same ticker
                  </p>
                </div>
                <Link
                  href="/analytics"
                  className="shrink-0 text-[12px] font-semibold text-primary hover:opacity-75"
                >
                  Full breakdown →
                </Link>
              </div>
              <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-muted">
                {portfolioSplit.map((item) => (
                  <span
                    key={item.symbol}
                    title={`${item.symbol}: ${item.share.toFixed(1)}%`}
                    style={{
                      width: `${item.share}%`,
                      background: item.color,
                    }}
                  />
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-3">
                {portfolioSplit.map((item) => (
                  <div
                    key={item.symbol}
                    className="min-w-0 rounded-lg border border-border bg-card px-3.5 py-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2">
                        <i
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: item.color }}
                        />
                        <span className="truncate text-[13px] font-semibold text-foreground">
                          {item.symbol}
                        </span>
                      </span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {item.kind}
                      </span>
                    </div>
                    <p className="mt-2 font-mono text-[26px] font-bold leading-none tracking-[-0.04em] text-foreground">
                      {item.share.toFixed(1)}%
                    </p>
                    <p className="mt-2 font-mono text-[11px] font-medium text-muted-foreground">
                      {privacy ? '••••' : formatMoney(item.value, true)}
                    </p>
                  </div>
                ))}
                {!portfolioSplit.length && (
                  <div className="col-span-full rounded-lg border border-dashed border-border px-4 py-6 text-center text-[12px] text-muted-foreground">
                    Add a priced asset to see the portfolio split.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-border bg-[var(--surface-subtle)] p-4 lg:border-l lg:border-t-0">
            <div className="flex items-start justify-between gap-3 px-2">
              <div>
                <p className="text-[12px] font-medium text-foreground">
                  Portfolio performance history
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {primaryHistorySources.length
                    ? `${primaryHistorySources.join(' + ')} · ${historyMetric === 'equity' ? 'transfer-adjusted equity' : 'cumulative trading P&L'}`
                    : historyMetric === 'equity'
                      ? 'Local portfolio snapshots'
                      : 'Whole-portfolio tracking starts with the first saved snapshot'}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <div className="flex items-center gap-1.5">
                  <div className="flex rounded-lg border border-border bg-muted p-0.5 text-[10px] font-semibold">
                    {(['equity', 'pnl'] as const).map((metric) => (
                      <button
                        key={metric}
                        type="button"
                        onClick={() => setHistoryMetric(metric)}
                        className={`rounded-md px-2.5 py-1 transition ${historyMetric === metric ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                      >
                        {metric === 'equity' ? 'Equity' : 'P&L'}
                      </button>
                    ))}
                  </div>
                  {canSyncVenueHistory && (
                    <button
                      type="button"
                      onClick={() => void refreshVenueHistories(true)}
                      disabled={historyRefreshState === 'loading'}
                      aria-label="Refresh venue history"
                      title="Refresh venue history"
                      className="grid size-7 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
                    >
                      <RefreshCw
                        className={`size-3 ${historyRefreshState === 'loading' ? 'animate-spin' : ''}`}
                      />
                    </button>
                  )}
                </div>
                <HistoryRangeControl
                  range={range}
                  customRange={customRange}
                  onPreset={selectPreset}
                  onCustom={selectCustom}
                />
              </div>
            </div>
            {primaryHistory.length > 1 ? (
              <ChartContainer
                config={{
                  value: {
                    label: historyMetric === 'equity' ? 'Equity' : 'P&L',
                    color: primaryHistoryColor,
                  },
                }}
                className="h-[330px] w-full aspect-auto"
              >
                <AreaChart
                  data={primaryHistory}
                  margin={{ left: 4, right: 12, top: 24, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="overviewValue"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={primaryHistoryColor}
                        stopOpacity={0.2}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--primary)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  {historyMetric === 'pnl' && (
                    <ReferenceLine
                      y={0}
                      stroke="var(--border)"
                      strokeDasharray="4 4"
                    />
                  )}
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    scale="time"
                    domain={historyDomain}
                    allowDataOverflow={range === 'CUSTOM'}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) =>
                      formatHistoryTick(Number(value), range, customRange)
                    }
                    tick={{ fill: 'var(--chart-label)', fontSize: 11 }}
                    minTickGap={38}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    width={68}
                    tickCount={5}
                    domain={['auto', 'auto']}
                    tickFormatter={(value) =>
                      privacy ? '••' : formatCompactMoneyAxis(Number(value))
                    }
                    tick={{ fill: 'var(--chart-label)', fontSize: 11 }}
                  />
                  <Tooltip
                    content={
                      <ValueTooltip
                        privacy={privacy}
                        metric={
                          historyMetric === 'equity'
                            ? 'Portfolio equity'
                            : 'Cumulative P&L'
                        }
                        signed={historyMetric === 'pnl'}
                      />
                    }
                  />
                  <Area
                    type="linear"
                    dataKey="value"
                    stroke={primaryHistoryColor}
                    strokeWidth={2}
                    fill="url(#overviewValue)"
                    activeDot={{
                      r: 4,
                      fill: primaryHistoryColor,
                      stroke: 'var(--card)',
                    }}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <HistoryEmptyState
                message={
                  historyMetric === 'equity'
                    ? 'Two history points are needed to draw the selected equity range.'
                    : 'Whole-portfolio P&L tracking has started. Refresh prices to record the next point.'
                }
              />
            )}
          </div>
        </div>
      </Panel>

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Daily portfolio P&L"
          description="Every priced holding combined · additions and removals excluded from performance"
          aside={
            <span className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              {rangeLabel}
            </span>
          }
        />
        <div className="p-4 sm:p-5">
          {dailyPnlHistory.length ? (
            <ChartContainer
              config={{
                positive: { label: 'Gain', color: 'var(--positive)' },
                negative: { label: 'Loss', color: 'var(--negative)' },
              }}
              className="h-[285px] w-full aspect-auto"
            >
              <BarChart
                data={dailyPnlHistory}
                margin={{ left: 4, right: 16, top: 18, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <ReferenceLine
                  y={0}
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  scale="time"
                  domain={historyDomain}
                  allowDataOverflow={range === 'CUSTOM'}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) =>
                    formatHistoryTick(Number(value), range, customRange)
                  }
                  tick={{ fill: 'var(--chart-label)', fontSize: 11 }}
                  minTickGap={42}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={68}
                  tickCount={5}
                  domain={['auto', 'auto']}
                  tickFormatter={(value) =>
                    privacy ? '••' : formatCompactMoneyAxis(Number(value))
                  }
                  tick={{ fill: 'var(--chart-label)', fontSize: 11 }}
                />
                <Tooltip content={<DailyPnlTooltip privacy={privacy} />} />
                <Bar
                  dataKey="positive"
                  stackId="daily"
                  fill="var(--positive)"
                  fillOpacity={0.85}
                  radius={[5, 5, 3, 3]}
                  maxBarSize={44}
                />
                <Bar
                  dataKey="negative"
                  stackId="daily"
                  fill="var(--negative)"
                  fillOpacity={0.85}
                  radius={[3, 3, 5, 5]}
                  maxBarSize={44}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <HistoryEmptyState message="Daily bars appear after the portfolio has at least two saved valuation points. Tracking is active now." />
          )}
        </div>
      </Panel>

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Top daily P&L coins"
          description="Spot, staked, and perpetual positions combined by ticker · current quantities marked from each coin's 00:00 UTC price"
          aside={
            <div className="text-right">
              <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                Crypto P&amp;L since 00:00 UTC
              </p>
              <p
                className={`mt-1 font-mono text-[14px] font-bold ${dailyCoinPnl.total >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}
              >
                {dailyCoinPnl.coverage < dailyCoinPnl.requested
                  ? `${dailyCoinPnl.coverage}/${dailyCoinPnl.requested} coins priced`
                  : privacy
                    ? '••••'
                    : `${dailyCoinPnl.total > 0 ? '+' : ''}${formatMoney(dailyCoinPnl.total, true)}`}
              </p>
            </div>
          }
        />
        <div className="p-4 sm:p-5">
          {dailyCoinPnl.rows.length ? (
            <ChartContainer
              config={{
                positive: { label: 'Gain', color: 'var(--positive)' },
                negative: { label: 'Loss', color: 'var(--negative)' },
              }}
              className="h-[340px] w-full aspect-auto"
            >
              <BarChart
                data={dailyCoinPnl.rows}
                layout="vertical"
                margin={{ left: 4, right: 24, top: 10, bottom: 4 }}
              >
                <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
                <ReferenceLine
                  x={0}
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) =>
                    privacy ? '••' : formatCompactMoneyAxis(Number(value))
                  }
                  tick={{ fill: 'var(--chart-label)', fontSize: 11 }}
                />
                <YAxis
                  type="category"
                  dataKey="symbol"
                  axisLine={false}
                  tickLine={false}
                  width={64}
                  tick={{
                    fill: 'var(--foreground)',
                    fontSize: 12,
                    fontWeight: 650,
                  }}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', fillOpacity: 0.45 }}
                  content={<DailyCoinPnlTooltip privacy={privacy} />}
                />
                <Bar
                  dataKey="positive"
                  stackId="daily-coin"
                  fill="var(--positive)"
                  fillOpacity={0.9}
                  maxBarSize={30}
                  radius={[5, 5, 5, 5]}
                />
                <Bar
                  dataKey="negative"
                  stackId="daily-coin"
                  fill="var(--negative)"
                  fillOpacity={0.9}
                  maxBarSize={30}
                  radius={[5, 5, 5, 5]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <HistoryEmptyState message="Daily coin attribution appears after market history resolves. Coin prices are measured from the 00:00 UTC candle boundary." />
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Showing the {Math.min(10, dailyCoinPnl.coverage)} largest of{' '}
            {dailyCoinPnl.coverage} priced coin contributors by absolute
            P&amp;L. Stablecoins are excluded. Staked balances are included;
            newly earned reward tokens enter after the wallet is resynced.
            Quantity changes made after midnight are applied to the full UTC-day
            move.
          </p>
        </div>
      </Panel>

      <section className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Activity}
          label="24h return"
          value={
            privacy
              ? '••••'
              : `${analytics.dayPnl >= 0 ? '+' : ''}${formatMoney(analytics.dayPnl)}`
          }
          detail={`${analytics.dayChange >= 0 ? '+' : ''}${analytics.dayChange.toFixed(2)}% across priced positions`}
          tone={analytics.dayPnl >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          icon={Crosshair}
          label="At all targets"
          value={
            analytics.targetsCount
              ? privacy
                ? '••••'
                : formatMoney(analytics.targetPortfolioValue)
              : 'Targets not set'
          }
          detail={
            analytics.targetsCount
              ? `${targetChange >= 0 ? '+' : ''}${targetChange.toFixed(1)}% modeled upside · ${analytics.targetsCount} targets`
              : 'Build plans on the Targets page'
          }
          tone={
            analytics.targetsCount && targetChange >= 0 ? 'positive' : 'default'
          }
        />
        <MetricCard
          icon={ShieldAlert}
          label="Margin used"
          value={
            analytics.perps.length
              ? privacy
                ? '••••'
                : formatMoney(analytics.marginUsed)
              : 'No perps'
          }
          detail={`${analytics.marginUtilization.toFixed(1)}% of leverage equity · ${analytics.stopsCount}/${analytics.perps.length} protected`}
        />
        <MetricCard
          icon={Layers3}
          label="Exposure diversification"
          value={`${analytics.diversificationScore} / 100`}
          detail={
            analytics.largestAssetExposure
              ? `${analytics.largestAssetExposure.symbol} is ${analytics.largestAssetExposure.exposureAllocation.toFixed(1)}% of gross exposure`
              : 'Add positions to measure'
          }
          tone="accent"
        />
      </section>

      {largestAssets.length > 0 && (
        <Panel className="mt-3 overflow-hidden">
          <PanelHeader
            title="Market trends"
            description="Recent price movement for the portfolio's largest exposures · each chart uses its own market range"
            aside={
              <span className="whitespace-nowrap rounded-md border border-border bg-muted px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
                Live market data
              </span>
            }
          />
          <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {largestAssets.map((asset) => {
              const sparkline = sparklines[asset.key];
              return (
                <MarketTrendCard
                  key={asset.key}
                  symbol={asset.symbol}
                  color={asset.color}
                  series={sparkline}
                />
              );
            })}
          </div>
        </Panel>
      )}

      <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(310px,.55fr)]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Largest asset exposures"
            description="Matching crypto positions combine by ticker; stocks remain a distinct asset class"
            aside={
              <Link
                href="/positions"
                className="text-[11px] font-medium text-primary hover:opacity-75"
              >
                Open ledger →
              </Link>
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/25 px-5 py-3.5">
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">
                Daily portfolio P&amp;L
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Trading day · resets at 00:00 UTC
              </p>
            </div>
            <p
              className={`font-mono text-[20px] font-bold tracking-[-0.03em] ${todayPnl >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}
            >
              <Money value={todayPnl} privacy={privacy} signed />
            </p>
          </div>
          <div className="divide-y divide-border">
            {largestAssets.map((asset) => (
              <div
                key={asset.key}
                className="grid w-full gap-4 px-5 py-4 lg:grid-cols-[minmax(190px,1fr)_130px_120px_170px] lg:items-center"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-lg text-[11px] font-bold text-slate-950"
                    style={{ background: asset.color }}
                  >
                    {asset.symbol.slice(0, 1)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-foreground">
                      {asset.symbol}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {asset.kind} · {asset.positionCount} position
                      {asset.positionCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">
                    Combined equity
                  </p>
                  <p className="mt-1.5 font-mono text-[11px] font-medium text-foreground">
                    {privacy ? '••••' : formatMoney(asset.value)}
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-[10px] text-muted-foreground">
                    Portfolio weight
                  </p>
                  <p className="mt-1 font-mono text-[22px] font-bold tracking-[-0.04em] text-primary">
                    {asset.allocation.toFixed(1)}%
                  </p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-[10px] text-muted-foreground">
                    Gross exposure
                  </p>
                  <div className="mt-1 flex items-baseline justify-between gap-2 sm:justify-end">
                    <span className="font-mono text-[11px] font-medium text-foreground">
                      {privacy ? '••••' : formatMoney(asset.exposureValue)}
                    </span>
                    <span className="font-mono text-[17px] font-bold text-[var(--information)]">
                      {asset.exposureAllocation.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, asset.exposureAllocation)}%`,
                        background: asset.color,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {!analytics.holdings.length && (
              <div className="grid min-h-48 place-items-center text-center">
                <div>
                  <WalletCards className="mx-auto size-5 text-muted-foreground" />
                  <p className="mt-3 text-[10px] text-muted-foreground">
                    No positions yet.
                  </p>
                </div>
              </div>
            )}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader
            title="Gross exposure mix"
            description={`Grouped by asset and ticker · $${analytics.minimumPositionValue.toLocaleString()} asset minimum`}
          />
          {analytics.grossExposure > 0 ? (
            <>
              <div className="relative mx-auto h-[220px] max-w-[270px]">
                <ChartContainer
                  config={{ exposureValue: { label: 'Exposure' } }}
                  className="h-full w-full aspect-auto"
                >
                  <PieChart>
                    <Pie
                      data={analytics.assetData
                        .filter((asset) => asset.exposureValue > 0)
                        .map((asset) => ({ ...asset, fill: asset.color }))}
                      dataKey="exposureValue"
                      nameKey="symbol"
                      innerRadius={62}
                      outerRadius={86}
                      paddingAngle={3}
                      stroke="transparent"
                    />
                    <Tooltip
                      content={<AllocationTooltip privacy={privacy} />}
                    />
                  </PieChart>
                </ChartContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div>
                    <p className="text-[10px] text-muted-foreground">Assets</p>
                    <p className="mt-1 font-mono text-xl font-semibold">
                      {String(analytics.assetData.length).padStart(2, '0')}
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-1 px-5 pb-5">
                {analytics.assetData.slice(0, 8).map((asset) => (
                  <div
                    key={asset.key}
                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[11px] hover:bg-muted"
                  >
                    <span className="flex min-w-0 items-center gap-2.5 font-medium text-foreground">
                      <i
                        className="size-2 rounded-full"
                        style={{ background: asset.color }}
                      />
                      <span className="truncate">{asset.symbol}</span>
                    </span>
                    <span className="flex items-baseline gap-3">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {privacy
                          ? '••••'
                          : formatMoney(asset.exposureValue, true)}
                      </span>
                      <span className="w-16 text-right font-mono text-[17px] font-bold text-foreground">
                        {asset.exposureAllocation.toFixed(1)}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="grid h-64 place-items-center text-[9px] text-muted-foreground">
              Exposure appears after adding a priced position.
            </div>
          )}
        </Panel>
      </section>
    </>
  );
}

function MarketTrendCard({
  symbol,
  color,
  series,
}: {
  symbol: string;
  color: string;
  series?: SparklineSeries;
}) {
  const points = series?.points ?? [];
  const chartData = points.map((value, index) => ({ index, value }));
  const first = points[0];
  const latest = points.at(-1);
  const low = points.length ? Math.min(...points) : null;
  const high = points.length ? Math.max(...points) : null;
  const span = low != null && high != null ? high - low : 0;
  const padding = Math.max(span * 0.14, Number(latest ?? 0) * 0.001, 0.000001);
  const chartDomain: [number, number] = [
    Math.max(0, Number(low ?? 0) - padding),
    Number(high ?? 0) + padding,
  ];
  const isPositive = Number(series?.changePercent ?? 0) >= 0;
  const trendColor = isPositive ? 'var(--positive)' : 'var(--negative)';

  return (
    <article className="min-w-0 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-lg text-[10px] font-bold text-slate-950"
            style={{ background: color }}
          >
            {symbol.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold text-foreground">
              {symbol}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {series?.range ?? 'Recent'} price
            </p>
          </div>
        </div>
        <span
          className="whitespace-nowrap font-mono text-[13px] font-bold"
          style={{ color: trendColor }}
        >
          {series?.changePercent == null
            ? '—'
            : `${isPositive ? '+' : ''}${series.changePercent.toFixed(1)}%`}
        </span>
      </div>

      {points.length > 1 ? (
        <figure
          className="mt-4"
          aria-label={`${symbol} ${series?.range ?? 'recent'} price trend`}
        >
          <ChartContainer
            config={{ price: { color: trendColor } }}
            className="h-[104px] w-full aspect-auto"
            initialDimension={{ width: 220, height: 104 }}
          >
            <AreaChart
              data={chartData}
              margin={{ top: 5, right: 2, bottom: 5, left: 2 }}
            >
              <YAxis hide domain={chartDomain} />
              <ReferenceLine
                y={first}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 4"
                strokeOpacity={0.35}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--color-price)"
                strokeWidth={2.5}
                fill="var(--color-price)"
                fillOpacity={0.14}
                baseValue={chartDomain[0]}
                dot={false}
                activeDot={{ r: 3, strokeWidth: 0 }}
                isAnimationActive={false}
              />
              <Tooltip
                content={<MarketPriceTooltip />}
                cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
              />
            </AreaChart>
          </ChartContainer>
        </figure>
      ) : (
        <div className="mt-4 grid h-[104px] place-items-center rounded-lg border border-dashed border-border bg-muted/25 text-[10px] text-muted-foreground">
          Market history unavailable
        </div>
      )}

      <div className="mt-3 flex items-end justify-between gap-3 border-t border-border pt-3">
        <div>
          <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
            Latest
          </p>
          <p className="mt-1 font-mono text-[13px] font-semibold text-foreground">
            {latest == null ? '—' : formatMarketPrice(latest)}
          </p>
        </div>
        <div className="text-right font-mono text-[9px] leading-4 text-muted-foreground">
          <p>L {low == null ? '—' : formatMarketPrice(low)}</p>
          <p>H {high == null ? '—' : formatMarketPrice(high)}</p>
        </div>
      </div>
    </article>
  );
}

function MarketPriceTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-2 shadow-lg">
      <p className="text-[9px] text-muted-foreground">Market price</p>
      <p className="mt-1 font-mono text-[11px] font-semibold text-foreground">
        {formatMarketPrice(Number(payload[0].value))}
      </p>
    </div>
  );
}

function formatMarketPrice(value: number) {
  const digits = value < 1 ? 5 : value < 100 ? 3 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < 1 ? Math.min(4, digits) : 2,
    maximumFractionDigits: digits,
  }).format(value);
}

function utcCalendarDay(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
}

function HeroMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bg-card px-4 py-4">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-[16px] font-bold text-foreground">
        {value}
      </p>
      <p className="mt-1.5 text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function ValueTooltip({
  active,
  payload,
  privacy,
  metric,
  signed = false,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: {
      label?: string;
      origin?: 'venue' | 'local';
      sources?: string[];
    };
    value?: number;
  }>;
  privacy: boolean;
  metric: string;
  signed?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const value = Number(payload[0].value);
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="text-[10px] font-medium text-muted-foreground">
        {point?.label}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">{metric}</p>
      <p className="mt-1 font-mono text-[13px] font-semibold text-foreground">
        {privacy
          ? '••••'
          : `${signed && value > 0 ? '+' : ''}${formatMoney(value)}`}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {point?.origin === 'venue'
          ? point.sources?.join(' + ') || 'Venue history'
          : 'Local snapshot'}
      </p>
    </div>
  );
}

function DailyPnlTooltip({
  active,
  payload,
  privacy,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: { label?: string; value?: number };
  }>;
  privacy: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const value = Number(point?.value ?? 0);
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="text-[10px] font-medium text-muted-foreground">
        {point?.label}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Whole-portfolio daily P&amp;L
      </p>
      <p
        className={`mt-1 font-mono text-[13px] font-semibold ${value >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}
      >
        {privacy ? '••••' : `${value > 0 ? '+' : ''}${formatMoney(value)}`}
      </p>
    </div>
  );
}

function DailyCoinPnlTooltip({
  active,
  payload,
  privacy,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: {
      symbol?: string;
      pnl?: number;
      dayOpen?: number;
      latestPrice?: number;
      changePercent?: number | null;
      positionCount?: number;
    };
  }>;
  privacy: boolean;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const pnl = Number(point?.pnl ?? 0);
  const change = Number(point?.changePercent);
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="text-[11px] font-semibold text-foreground">
        {point?.symbol} · UTC daily contribution
      </p>
      <p
        className={`mt-1.5 font-mono text-[13px] font-bold ${pnl >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}
      >
        {privacy ? '••••' : `${pnl > 0 ? '+' : ''}${formatMoney(pnl)}`}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {Number.isFinite(change)
          ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}% market move`
          : 'Market move unavailable'}{' '}
        · {point?.positionCount ?? 0} position
        {point?.positionCount === 1 ? '' : 's'}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {privacy
          ? '00:00 UTC •••• → now ••••'
          : `00:00 UTC ${formatMarketPrice(Number(point?.dayOpen))} → now ${formatMarketPrice(Number(point?.latestPrice))}`}
      </p>
    </div>
  );
}

function HistoryEmptyState({ message }: { message: string }) {
  return (
    <div className="grid h-[250px] place-items-center rounded-xl border border-dashed border-border bg-muted/30 px-6 text-center">
      <div>
        <p className="text-[13px] font-semibold text-foreground">
          No chart data in this range
        </p>
        <p className="mx-auto mt-2 max-w-lg text-[12px] leading-5 text-muted-foreground">
          {message}
        </p>
      </div>
    </div>
  );
}

function AllocationTooltip({
  active,
  payload,
  privacy,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    payload?: { exposureAllocation?: number };
  }>;
  privacy: boolean;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="text-[9px] font-semibold">{item.name}</p>
      <p className="mt-1 font-mono text-[8px] text-muted-foreground">
        {privacy ? 'Hidden' : formatMoney(Number(item.value))} ·{' '}
        {Number(item.payload?.exposureAllocation).toFixed(1)}%
      </p>
    </div>
  );
}
