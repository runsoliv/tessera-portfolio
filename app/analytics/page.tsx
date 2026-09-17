'use client';

import { useMemo, useState } from 'react';
import {
  Building2,
  DatabaseZap,
  Layers3,
  Network,
  PieChart as PieIcon,
  Scale,
  ShieldCheck,
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
  PageIntro,
  Panel,
  PanelHeader,
} from '@/components/page-primitives';
import { ChartContainer } from '@/components/ui/chart';
import {
  diversificationLabel,
  filterSnapshots,
  formatCompactMoneyAxis,
  formatHistoryTick,
} from '@/lib/analytics';
import { formatMoney } from '@/lib/portfolio';
import {
  buildPortfolioHistory,
  buildPortfolioPnlHistory,
  historySourceLabels,
  pnlHistorySourceLabels,
} from '@/lib/venue-history';

type AllocationMode = 'equity' | 'exposure';

export default function AnalyticsPage() {
  const { portfolio, analytics } = usePortfolio();
  const {
    range,
    customRange,
    label: rangeLabel,
    selectPreset,
    selectCustom,
  } = usePersistentHistoryRange();
  const [mode, setMode] = useState<AllocationMode>('exposure');
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
  const combinedPnlHistory = useMemo(
    () => buildPortfolioPnlHistory(portfolio.venueHistories ?? []),
    [portfolio.venueHistories],
  );
  const pnlHistory = useMemo(
    () => filterSnapshots(combinedPnlHistory, range, customRange),
    [combinedPnlHistory, customRange, range],
  );
  const historySources = useMemo(
    () => historySourceLabels(portfolio.venueHistories ?? []),
    [portfolio.venueHistories],
  );
  const pnlHistorySources = useMemo(
    () => pnlHistorySourceLabels(portfolio.venueHistories ?? []),
    [portfolio.venueHistories],
  );
  const historyDomain: [number, number] | ['dataMin', 'dataMax'] =
    range === 'CUSTOM' && customRange
      ? [customRange.start, customRange.end]
      : ['dataMin', 'dataMax'];
  const allocationData = useMemo(
    () =>
      analytics.assetData
        .filter((asset) =>
          mode === 'equity' ? asset.value > 0 : asset.exposureValue > 0,
        )
        .map((asset) => ({
          ...asset,
          chartValue: mode === 'equity' ? asset.value : asset.exposureValue,
          fill: asset.color,
        })),
    [analytics.assetData, mode],
  );
  const networkData = useMemo(() => {
    const values = new Map<string, number>();
    for (const holding of analytics.holdings)
      values.set(
        holding.network ?? 'Unknown',
        (values.get(holding.network ?? 'Unknown') ?? 0) + holding.value,
      );
    return Array.from(values, ([network, value]) => ({ network, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [analytics.holdings]);
  const providerData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const holding of analytics.holdings)
      counts.set(
        holding.provider ?? 'Unresolved',
        (counts.get(holding.provider ?? 'Unresolved') ?? 0) + 1,
      );
    return Array.from(counts, ([provider, count]) => ({
      provider,
      count,
    })).sort((a, b) => b.count - a.count);
  }, [analytics.holdings]);

  return (
    <>
      <PageIntro
        eyebrow="Reporting"
        title="Portfolio analytics"
        description="Review allocation, exposure, performance contribution, concentration, network distribution and market-data coverage."
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          icon={Layers3}
          label="Exposure diversification"
          value={`${analytics.diversificationScore} / 100`}
          detail={diversificationLabel(analytics.diversificationScore)}
          tone="accent"
        />
        <MetricCard
          icon={Scale}
          label="Largest exposure"
          value={
            analytics.largestAssetExposure
              ? `${analytics.largestAssetExposure.symbol} · ${analytics.largestAssetExposure.exposureAllocation.toFixed(1)}%`
              : 'No positions'
          }
          detail={
            analytics.largestAssetExposure
              ? privacy
                ? 'Exposure hidden'
                : `${formatMoney(analytics.largestAssetExposure.exposureValue)} combined ${analytics.largestAssetExposure.kind}`
              : 'Add positions to measure'
          }
        />
        <MetricCard
          icon={ShieldCheck}
          label="Stablecoin reserve"
          value={`${analytics.stablecoinAllocation.toFixed(1)}%`}
          detail="Share of spot value in common stablecoins"
        />
        <MetricCard
          icon={Building2}
          label="Largest platform"
          value={
            analytics.largestPlatform
              ? `${analytics.largestPlatform.platform} · ${analytics.largestPlatform.allocation.toFixed(1)}%`
              : 'No platforms'
          }
          detail={`${analytics.platformCount} recorded venue${analytics.platformCount === 1 ? '' : 's'}`}
        />
        <MetricCard
          icon={DatabaseZap}
          label="Price coverage"
          value={`${analytics.resolvedCount}/${analytics.holdings.length}`}
          detail={`${analytics.providerCount} active provider${analytics.providerCount === 1 ? '' : 's'}`}
          tone={
            analytics.holdings.length > 0 &&
            analytics.resolvedCount === analytics.holdings.length
              ? 'positive'
              : 'default'
          }
        />
      </section>

      <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Portfolio mix"
            description={`${mode === 'equity' ? 'Share of portfolio equity' : 'Share of gross economic exposure'} · $${analytics.minimumPositionValue.toLocaleString()} asset minimum`}
            aside={
              <div className="flex rounded-xl border border-border bg-muted p-1 text-[11px] text-muted-foreground">
                {(['equity', 'exposure'] as AllocationMode[]).map((item) => (
                  <button
                    key={item}
                    onClick={() => setMode(item)}
                    className={`rounded-lg px-3 py-1.5 font-medium capitalize transition ${mode === item ? 'bg-card text-foreground shadow-sm' : 'hover:text-foreground'}`}
                  >
                    {item}
                  </button>
                ))}
              </div>
            }
          />
          <div className="grid gap-5 p-5 sm:grid-cols-[300px_minmax(0,1fr)] sm:items-center">
            <div className="relative h-[285px]">
              <ChartContainer
                config={{ chartValue: { label: mode } }}
                className="h-full w-full aspect-auto"
              >
                <PieChart>
                  <Pie
                    data={allocationData}
                    dataKey="chartValue"
                    nameKey="symbol"
                    innerRadius={76}
                    outerRadius={112}
                    paddingAngle={2}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                  <Tooltip content={<AllocationTooltip privacy={privacy} />} />
                </PieChart>
              </ChartContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div>
                  <PieIcon className="mx-auto size-5 text-primary" />
                  <p className="mt-2 font-mono text-2xl font-bold">
                    {allocationData.length}
                  </p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    assets
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-2.5">
              {allocationData.slice(0, 8).map((asset) => {
                const total = allocationData.reduce(
                  (sum, item) => sum + item.chartValue,
                  0,
                );
                const share = total ? (asset.chartValue / total) * 100 : 0;
                return (
                  <div
                    key={asset.key}
                    className="rounded-xl border border-border bg-card px-3.5 py-3"
                  >
                    <div className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-4">
                      <div className="min-w-0">
                        <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                          <i
                            className="size-2.5 shrink-0 rounded-full"
                            style={{ background: asset.color }}
                          />
                          <span className="truncate">{asset.symbol}</span>
                          <span className="truncate text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                            {asset.kind}
                          </span>
                        </span>
                        <span className="mt-1.5 block font-mono text-[11px] text-muted-foreground">
                          {privacy
                            ? '••••'
                            : formatMoney(asset.chartValue, true)}
                        </span>
                      </div>
                      <span className="text-right font-mono text-[24px] font-bold tracking-[-0.05em] text-foreground">
                        {share.toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${share}%`,
                          background: asset.color,
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader
            title="Portfolio equity curve"
            description={
              historySources.length
                ? `${historySources.join(' + ')} transfer-adjusted history anchored to current portfolio equity`
                : 'Snapshots recorded during price refreshes'
            }
            aside={
              <HistoryRangeControl
                range={range}
                customRange={customRange}
                onPreset={selectPreset}
                onCustom={selectCustom}
              />
            }
          />
          <div className="p-4">
            {history.length > 1 ? (
              <ChartContainer
                config={{ value: { label: 'Equity' } }}
                className="h-[285px] w-full aspect-auto"
              >
                <AreaChart
                  data={history}
                  margin={{ left: 4, right: 12, top: 18, bottom: 0 }}
                >
                  <defs>
                    <linearGradient
                      id="analyticsValue"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--primary)"
                        stopOpacity={0.24}
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--primary)"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis
                    dataKey="timestamp"
                    type="number"
                    scale="time"
                    domain={historyDomain}
                    allowDataOverflow={range === 'CUSTOM'}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={42}
                    tickFormatter={(value) =>
                      formatHistoryTick(Number(value), range, customRange)
                    }
                    tick={{ fill: 'var(--chart-label)', fontSize: 11 }}
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
                      <HistoryTooltip
                        privacy={privacy}
                        metric="Portfolio equity"
                      />
                    }
                  />
                  <Area
                    type="linear"
                    dataKey="value"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    fill="url(#analyticsValue)"
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <HistoryEmptyState message="Two history points are needed to draw the selected equity range." />
            )}
          </div>
        </Panel>
      </section>

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Historical venue P&L"
          description={
            pnlHistorySources.length
              ? `${pnlHistorySources.join(' + ')} cumulative P&L · transfer-adjusted venue data`
              : 'Historical P&L appears when a connected venue exposes it'
          }
          aside={
            <span className="rounded-lg border border-border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
              {rangeLabel}
            </span>
          }
        />
        <div className="p-4 sm:p-5">
          {pnlHistory.length > 1 ? (
            <ChartContainer
              config={{ value: { label: 'Cumulative P&L' } }}
              className="h-[300px] w-full aspect-auto"
            >
              <AreaChart
                data={pnlHistory}
                margin={{ left: 4, right: 16, top: 18, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="analyticsPnl" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--information)"
                      stopOpacity={0.24}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--information)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
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
                  minTickGap={42}
                  tickFormatter={(value) =>
                    formatHistoryTick(Number(value), range, customRange)
                  }
                  tick={{ fill: 'var(--chart-label)', fontSize: 11 }}
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
                    <HistoryTooltip
                      privacy={privacy}
                      metric="Cumulative P&L"
                      signed
                    />
                  }
                />
                <Area
                  type="linear"
                  dataKey="value"
                  stroke="var(--information)"
                  strokeWidth={2}
                  fill="url(#analyticsPnl)"
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <HistoryEmptyState message="Historical P&L is unavailable for this venue or selected range. Hyperliquid exposes public history; standard Lighter account history requires venue authorization." />
          )}
        </div>
      </Panel>

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Equity by platform"
          description="Where portfolio equity is held, separated from underlying blockchain networks"
          aside={
            <span className="rounded-lg border border-border bg-muted/40 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
              {analytics.platformCount} venue
              {analytics.platformCount === 1 ? '' : 's'}
            </span>
          }
        />
        {analytics.platformData.length ? (
          <div className="p-5">
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              {analytics.platformData
                .filter((item) => item.value > 0)
                .map((item) => (
                  <div
                    key={item.platform}
                    title={`${item.platform}: ${item.allocation.toFixed(1)}%`}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{
                      width: `${Math.max(0, item.allocation)}%`,
                      background: item.color,
                    }}
                  />
                ))}
            </div>
            <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
              {analytics.platformData.map((item) => (
                <div key={item.platform} className="bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-2 truncate text-[11px] font-medium text-foreground">
                      <i
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ background: item.color }}
                      />
                      {item.platform}
                    </p>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {item.allocation.toFixed(1)}%
                    </span>
                  </div>
                  <p className="mt-3 font-mono text-[14px] font-semibold">
                    {privacy ? '••••' : formatMoney(item.value)}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
                    <PlatformStat
                      label="Spot"
                      value={
                        privacy ? '••••' : formatMoney(item.spotValue, true)
                      }
                    />
                    <PlatformStat
                      label="Perp eq."
                      value={
                        privacy ? '••••' : formatMoney(item.perpEquity, true)
                      }
                    />
                    <PlatformStat
                      label="Staked"
                      value={
                        privacy ? '••••' : formatMoney(item.stakedValue, true)
                      }
                    />
                  </div>
                  <p className="mt-3 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                    {item.count} position{item.count === 1 ? '' : 's'}
                    {item.notional > 0
                      ? ` · ${privacy ? 'hidden' : formatMoney(item.notional, true)} perp notional`
                      : ''}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-16 text-center text-[10px] text-muted-foreground">
            Platform data appears after positions are added.
          </div>
        )}
      </Panel>

      <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="24h P&L contribution"
            description="Dollar impact of each position, adjusted for perp direction"
          />
          <div className="p-4">
            <ChartContainer
              config={{
                positive: { label: 'Gain' },
                negative: { label: 'Loss' },
              }}
              className="h-[230px] w-full aspect-auto"
            >
              <BarChart
                data={analytics.contributionData}
                margin={{ left: 2, right: 2, top: 12, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                <XAxis
                  dataKey="symbol"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--chart-label)', fontSize: 10 }}
                />
                <YAxis hide />
                <Tooltip content={<ContributionTooltip privacy={privacy} />} />
                <Bar
                  dataKey="positive"
                  fill="var(--positive)"
                  fillOpacity={0.78}
                  radius={[5, 5, 2, 2]}
                />
                <Bar
                  dataKey="negative"
                  fill="var(--destructive)"
                  fillOpacity={0.78}
                  radius={[2, 2, 5, 5]}
                />
              </BarChart>
            </ChartContainer>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader
            title="Network distribution"
            description="Equity grouped by recorded chain or venue"
          />
          <div className="divide-y divide-border px-5">
            {networkData.map((item, index) => (
              <div
                key={item.network}
                className="grid grid-cols-[24px_minmax(0,1fr)_80px] items-center gap-2 py-3"
              >
                <span className="font-mono text-[10px] text-muted-foreground">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <p className="text-[11px] text-foreground">{item.network}</p>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[var(--information)]"
                      style={{
                        width: `${analytics.totalValue ? Math.max(0, (item.value / analytics.totalValue) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-right font-mono text-[10px] text-muted-foreground">
                  {privacy ? '••••' : formatMoney(item.value, true)}
                </span>
              </div>
            ))}
            {!networkData.length && (
              <div className="py-16 text-center text-[10px] text-muted-foreground">
                No network data yet.
              </div>
            )}
          </div>
        </Panel>
      </section>

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Market data provenance"
          description="The source currently supplying each position’s mark"
        />
        <div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
          {providerData.map((item) => (
            <div key={item.provider} className="bg-card p-4">
              <div className="flex items-center justify-between">
                <Network className="size-3.5 text-muted-foreground" />
                <span className="font-mono text-[11px] text-primary">
                  {item.count}
                </span>
              </div>
              <p className="mt-3 truncate text-[11px] text-foreground">
                {item.provider}
              </p>
              <p className="mt-1 text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
                active position{item.count === 1 ? '' : 's'}
              </p>
            </div>
          ))}
          {!providerData.length && (
            <div className="col-span-full py-14 text-center text-[10px] text-muted-foreground">
              Sources appear after the first price refresh.
            </div>
          )}
        </div>
      </Panel>
    </>
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
    payload?: { kind?: string };
  }>;
  privacy: boolean;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <Tip>
      <p className="text-[9px] font-semibold">
        {item.name} · {item.payload?.kind}
      </p>
      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
        {privacy ? 'Hidden' : formatMoney(Number(item.value))}
      </p>
    </Tip>
  );
}
function HistoryTooltip({
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
    <Tip>
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
    </Tip>
  );
}

function HistoryEmptyState({ message }: { message: string }) {
  return (
    <div className="grid h-[255px] place-items-center rounded-xl border border-dashed border-border bg-muted/30 px-6 text-center">
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
function ContributionTooltip({
  active,
  payload,
  privacy,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { symbol?: string; pnl?: number } }>;
  privacy: boolean;
}) {
  if (!active || !payload?.length) return null;
  const value = Number(payload[0].payload?.pnl ?? 0);
  return (
    <Tip>
      <p className="text-[10px] text-muted-foreground">
        {payload[0].payload?.symbol} impact
      </p>
      <p
        className={`mt-1 font-mono text-[11px] ${value >= 0 ? 'text-[var(--positive)]' : 'text-destructive'}`}
      >
        {privacy ? '••••' : `${value >= 0 ? '+' : ''}${formatMoney(value)}`}
      </p>
    </Tip>
  );
}
function PlatformStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-[10px] text-foreground">
        {value}
      </p>
    </div>
  );
}
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      {children}
    </div>
  );
}
