'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Calculator,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Gauge,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  TimerReset,
  TrendingUp,
  Wifi,
} from 'lucide-react';

import {
  MetricCard,
  PageIntro,
  Panel,
  PanelHeader,
} from '@/components/page-primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  estimateFundingCarry,
  FUNDING_VENUES,
  nextFundingBoundary,
  type FundingHistoryPoint,
  type FundingOpportunity,
  type FundingQuote,
  type FundingVenue,
} from '@/lib/funding-arb';

type FundingResponse = {
  fetchedAt: number;
  opportunities: FundingOpportunity[];
  sources: { venue: FundingVenue; markets: number }[];
  warnings: string[];
};

type TrackedSpread = { timestamp: number; spread8h: number };
type TrackedSpreads = Record<string, TrackedSpread[]>;

export default function FundingArbPage() {
  const [data, setData] = useState<FundingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [notionalPerLeg, setNotionalPerLeg] = useState(10_000);
  const [holdHours, setHoldHours] = useState(24);
  const [costBpsPerFill, setCostBpsPerFill] = useState(2);
  const [rateRetentionPct, setRateRetentionPct] = useState(50);
  const [clock, setClock] = useState(() => Date.now());
  const [historyByMarket, setHistoryByMarket] = useState<
    Record<number, FundingHistoryPoint[]>
  >({});
  const [trackedSpreads, setTrackedSpreads] = useState<TrackedSpreads>(() => {
    if (typeof window === 'undefined') return {};
    try {
      return JSON.parse(
        window.localStorage.getItem('tessera-funding-spreads-v1') ?? '{}',
      ) as TrackedSpreads;
    } catch {
      return {};
    }
  });
  const [executionChecks, setExecutionChecks] = useState({
    symbol: '',
    bothLegsFilled: false,
    holdThroughSettlement: false,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/funding-arb', { cache: 'no-store' });
      if (!response.ok)
        throw new Error(`Funding feed returned ${response.status}`);
      const nextData = (await response.json()) as FundingResponse;
      setData(nextData);
      setTrackedSpreads((current) => {
        const next = { ...current };
        const cutoff = nextData.fetchedAt - 8 * 60 * 60 * 1_000;
        for (const opportunity of nextData.opportunities) {
          const previous = (next[opportunity.symbol] ?? []).filter(
            (point) => point.timestamp >= cutoff,
          );
          const last = previous.at(-1);
          next[opportunity.symbol] =
            last?.timestamp === nextData.fetchedAt
              ? previous
              : [
                  ...previous,
                  {
                    timestamp: nextData.fetchedAt,
                    spread8h: opportunity.spread8h,
                  },
                ].slice(-480);
        }
        try {
          window.localStorage.setItem(
            'tessera-funding-spreads-v1',
            JSON.stringify(next),
          );
        } catch {
          // Live tracking still works when browser storage is unavailable.
        }
        return next;
      });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Funding feeds are unavailable',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const search = query.trim().toUpperCase();
    return (data?.opportunities ?? []).filter(
      (opportunity) => !search || opportunity.symbol.includes(search),
    );
  }, [data?.opportunities, query]);
  const selected =
    filtered.find((opportunity) => opportunity.symbol === selectedSymbol) ??
    filtered[0] ??
    null;
  const selectedEstimate = selected
    ? estimateFundingCarry({
        opportunity: selected,
        notionalPerLeg,
        holdHours,
        executionCostBpsPerFill: costBpsPerFill,
      })
    : null;
  const lighterQuote = selected?.quotes.find(
    (quote) => quote.venue === 'Robinhood Lighter',
  );
  const lighterMarketId = lighterQuote?.marketId ?? null;
  const lighterHistory =
    lighterMarketId === null ? [] : (historyByMarket[lighterMarketId] ?? []);
  const trackedSelected = selected
    ? (trackedSpreads[selected.symbol] ?? [])
    : [];
  const retentionRatio = Math.min(100, Math.max(0, rateRetentionPct)) / 100;
  const conservativeNet = selectedEstimate
    ? selectedEstimate.grossCarry * retentionRatio -
      selectedEstimate.executionCost
    : null;
  const costCoverage = selectedEstimate
    ? selectedEstimate.executionCost > 0
      ? selectedEstimate.grossCarry / selectedEstimate.executionCost
      : Number.POSITIVE_INFINITY
    : 0;
  const sameCheckedSymbol = executionChecks.symbol === selected?.symbol;
  const profitableCount = filtered.filter(
    (opportunity) =>
      estimateFundingCarry({
        opportunity,
        notionalPerLeg,
        holdHours,
        executionCostBpsPerFill: costBpsPerFill,
      }).netCarry > 0,
  ).length;

  useEffect(() => {
    if (lighterMarketId === null || historyByMarket[lighterMarketId]) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/funding-arb/history?marketId=${lighterMarketId}`, {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('History unavailable');
          return (await response.json()) as { points: FundingHistoryPoint[] };
        })
        .then((payload) =>
          setHistoryByMarket((current) => ({
            ...current,
            [lighterMarketId]: payload.points,
          })),
        )
        .catch(() => undefined);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [historyByMarket, lighterMarketId]);

  return (
    <>
      <PageIntro
        eyebrow="Live cross-venue scanner"
        title="Funding rate arbitrage"
        description="Compare matching perpetuals on Robinhood Lighter and Variational. Rates are normalized to an 8-hour basis, then translated into a two-leg carry estimate."
        actions={
          <Button
            type="button"
            variant="outline"
            onClick={() => void refresh()}
            disabled={loading}
            className="h-9 border-border bg-card"
          >
            <RefreshCw
              className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh rates
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          data?.sources ??
          FUNDING_VENUES.map((venue) => ({ venue, markets: 0 }))
        ).map((source) => (
          <span
            key={source.venue}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground"
          >
            <span
              className={`size-1.5 rounded-full ${source.markets > 0 ? 'bg-[var(--positive)]' : 'bg-muted-foreground'}`}
            />
            <strong className="font-semibold text-foreground">
              {source.venue}
            </strong>
            {source.markets > 0
              ? `${source.markets} markets`
              : loading
                ? 'syncing'
                : 'offline'}
          </span>
        ))}
        {data?.fetchedAt ? (
          <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
            Updated {formatClock(data.fetchedAt)}
          </span>
        ) : null}
      </div>

      {(error || data?.warnings.length) && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/8 px-4 py-3 text-[11px] leading-5 text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
          <span>{error || data?.warnings.join(' · ')}</span>
        </div>
      )}

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Arbitrage calculator"
          description="Enter matched notional for each leg. Cost per fill is charged four times: opening and closing both the long and the short."
          aside={
            <Badge variant="outline" className="hidden sm:inline-flex">
              <Wifi /> Auto-refresh · 60s
            </Badge>
          }
        />
        <div className="grid gap-5 p-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="grid content-start gap-4 rounded-xl border border-border bg-muted/35 p-4 sm:grid-cols-3 xl:grid-cols-1">
            <NumberField
              label="Notional per leg"
              prefix="$"
              value={notionalPerLeg}
              min={0}
              step={1_000}
              onChange={setNotionalPerLeg}
            />
            <NumberField
              label="Expected hold"
              suffix="hours"
              value={holdHours}
              min={0}
              step={1}
              onChange={setHoldHours}
            />
            <NumberField
              label="Execution cost / fill"
              suffix="bps"
              value={costBpsPerFill}
              min={0}
              step={0.1}
              onChange={setCostBpsPerFill}
            />
            <NumberField
              label="Stress-case rate retained"
              suffix="%"
              value={rateRetentionPct}
              min={0}
              max={100}
              step={5}
              onChange={setRateRetentionPct}
            />
            <p className="text-[10px] leading-4 text-muted-foreground sm:col-span-3 xl:col-span-1">
              Capital required depends on each venue&apos;s leverage and margin
              rules. This estimates funding only; it does not include basis
              convergence, borrow, liquidation, withdrawal or gas costs.
            </p>
          </div>

          {selected && selectedEstimate ? (
            <div className="min-w-0 rounded-xl border border-primary/25 bg-primary/[0.045] p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="grid size-9 place-items-center rounded-lg bg-primary font-mono text-[13px] font-bold text-primary-foreground">
                      {selected.symbol.slice(0, 2)}
                    </span>
                    <div>
                      <p className="text-[18px] font-semibold tracking-[-0.03em]">
                        {selected.symbol} neutral carry
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Matched {formatMoney(notionalPerLeg)} long and short
                        legs
                      </p>
                    </div>
                  </div>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Estimated net carry
                  </p>
                  <p
                    className={`mt-1 font-mono text-[28px] font-semibold tracking-[-0.05em] ${selectedEstimate.netCarry >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}
                  >
                    {signedMoney(selectedEstimate.netCarry)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatDuration(holdHours)} · after{' '}
                    {formatMoney(selectedEstimate.executionCost)} costs
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-center">
                <VenueLeg
                  side="Long"
                  venue={selected.longVenue}
                  rate={selected.longRate8h}
                  icon={ArrowDownLeft}
                />
                <ArrowLeftRight className="mx-auto hidden size-4 text-muted-foreground md:block" />
                <VenueLeg
                  side="Short"
                  venue={selected.shortVenue}
                  rate={selected.shortRate8h}
                  icon={ArrowUpRight}
                />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/70 pt-4 sm:grid-cols-4">
                <CompactStat
                  label="8h spread"
                  value={formatRate(selected.spread8h)}
                />
                <CompactStat
                  label="Simple APR"
                  value={formatRate(selected.annualizedSpread)}
                />
                <CompactStat
                  label="Gross carry"
                  value={signedMoney(selectedEstimate.grossCarry)}
                />
                <CompactStat
                  label="Break-even"
                  value={
                    selectedEstimate.breakEvenHours === null
                      ? 'Never'
                      : formatDuration(selectedEstimate.breakEvenHours)
                  }
                />
              </div>
            </div>
          ) : (
            <div className="grid min-h-72 place-items-center rounded-xl border border-dashed border-border bg-muted/25 px-6 text-center">
              <div>
                <Calculator className="mx-auto size-7 text-muted-foreground" />
                <p className="mt-3 text-[13px] font-semibold">
                  {loading
                    ? 'Scanning common markets'
                    : 'No matching pairs found'}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {loading
                    ? 'The live venue feeds are loading.'
                    : 'No pair is currently listed on both venues.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {selected && selectedEstimate ? (
          <div className="border-t border-border p-5">
            <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-[13px] font-semibold">
                  Settlement readiness
                </h2>
                <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                  Payment clocks are separate. A displayed rate can still move
                  before either venue settles.
                </p>
              </div>
              <Badge variant="outline" className="w-fit">
                <TimerReset /> Live countdowns
              </Badge>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {selected.quotes.map((quote) => (
                <SettlementCard
                  key={quote.venue}
                  quote={quote}
                  now={clock}
                  lighterHistory={
                    quote.venue === 'Robinhood Lighter' ? lighterHistory : []
                  }
                  tracked={trackedSelected}
                />
              ))}
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-xl border border-border bg-muted/25 p-4">
                <div className="flex items-center gap-2">
                  <Gauge className="size-4 text-primary" />
                  <h3 className="text-[12px] font-semibold">
                    Carry stress test
                  </h3>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <CompactStat
                    label="Current net"
                    value={signedMoney(selectedEstimate.netCarry)}
                  />
                  <CompactStat
                    label={`${rateRetentionPct}% rate net`}
                    value={signedMoney(conservativeNet ?? 0)}
                  />
                  <CompactStat
                    label="Gross / costs"
                    value={
                      Number.isFinite(costCoverage)
                        ? `${costCoverage.toFixed(1)}×`
                        : 'No costs'
                    }
                  />
                </div>
                <p className="mt-3 text-[10px] leading-4 text-muted-foreground">
                  The stress case assumes only {rateRetentionPct}% of the
                  current spread survives for the full hold. Prefer a positive
                  stress result with comfortable room over four fills.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-muted/25 p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-primary" />
                  <h3 className="text-[12px] font-semibold">
                    Two-leg execution check
                  </h3>
                </div>
                <div className="mt-3 space-y-3">
                  <ReadinessRow
                    ready={costCoverage >= 3}
                    label="Expected funding covers all four fill costs by 3× or more"
                    detail={
                      Number.isFinite(costCoverage)
                        ? `${costCoverage.toFixed(1)}×`
                        : 'No costs'
                    }
                  />
                  <ReadinessRow
                    ready={(conservativeNet ?? 0) > 0}
                    label={`${rateRetentionPct}% rate-retention case stays profitable`}
                    detail={signedMoney(conservativeNet ?? 0)}
                  />
                  <ReadinessRow
                    ready={
                      trackedSelected.length < 2
                        ? null
                        : Math.min(
                            ...trackedSelected.map((point) => point.spread8h),
                          ) > 0
                    }
                    label="Spread stayed positive across observed refreshes"
                    detail={
                      trackedSelected.length < 2
                        ? 'Tracking'
                        : `${trackedSelected.length} samples`
                    }
                  />
                  <CheckRow
                    checked={
                      sameCheckedSymbol && executionChecks.bothLegsFilled
                    }
                    onCheckedChange={(checked) =>
                      setExecutionChecks((current) => ({
                        symbol: selected.symbol,
                        bothLegsFilled: checked,
                        holdThroughSettlement:
                          current.symbol === selected.symbol
                            ? current.holdThroughSettlement
                            : false,
                      }))
                    }
                    label="Both equal-notional legs are filled"
                  />
                  <CheckRow
                    checked={
                      sameCheckedSymbol && executionChecks.holdThroughSettlement
                    }
                    onCheckedChange={(checked) =>
                      setExecutionChecks((current) => ({
                        symbol: selected.symbol,
                        bothLegsFilled:
                          current.symbol === selected.symbol
                            ? current.bothLegsFilled
                            : false,
                        holdThroughSettlement: checked,
                      }))
                    }
                    label="I will verify both legs remain open through settlement"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Panel>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={ArrowLeftRight}
          label="Common pairs"
          value={String(filtered.length)}
          detail="Listed on both requested venues"
          tone="accent"
        />
        <MetricCard
          icon={TrendingUp}
          label="Positive after costs"
          value={String(profitableCount)}
          detail={`${formatDuration(holdHours)} horizon at ${costBpsPerFill} bps per fill`}
          tone={profitableCount > 0 ? 'positive' : 'default'}
        />
        <MetricCard
          icon={Sparkles}
          label="Best 8h spread"
          value={filtered[0] ? formatRate(filtered[0].spread8h) : '—'}
          detail={
            filtered[0]
              ? `${filtered[0].symbol} · ${filtered[0].longVenue} → ${filtered[0].shortVenue}`
              : 'Waiting for rates'
          }
          tone="positive"
        />
        <MetricCard
          icon={Clock3}
          label="Rate convention"
          value="8h normalized"
          detail="Simple annualization; no compounding assumed"
        />
      </section>

      <Panel className="mt-4 overflow-hidden">
        <PanelHeader
          title="Ranked funding spreads"
          description="Positive funding means longs pay shorts. The suggested long uses the lower rate and the suggested short uses the higher rate."
          aside={
            <span className="hidden text-[10px] uppercase tracking-[0.08em] text-muted-foreground sm:block">
              Click a row to calculate
            </span>
          }
        />
        <div className="border-b border-border px-5 py-4">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search ticker"
              className="h-9 bg-background pl-9"
              aria-label="Search funding pairs"
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="bg-muted/35 hover:bg-muted/35">
              <TableHead className="px-5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                Pair
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                Long · lower funding
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                Short · higher funding
              </TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                8h spread
              </TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                Simple APR
              </TableHead>
              <TableHead className="text-right text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                Est. net
              </TableHead>
              <TableHead className="px-5 text-right text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                Mark gap
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 60).map((opportunity) => {
              const estimate = estimateFundingCarry({
                opportunity,
                notionalPerLeg,
                holdHours,
                executionCostBpsPerFill: costBpsPerFill,
              });
              const active = selected?.symbol === opportunity.symbol;
              return (
                <TableRow
                  key={opportunity.symbol}
                  tabIndex={0}
                  aria-selected={active}
                  onClick={() => setSelectedSymbol(opportunity.symbol)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedSymbol(opportunity.symbol);
                    }
                  }}
                  className={`cursor-pointer ${active ? 'bg-primary/[0.06]' : ''}`}
                >
                  <TableCell className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid size-8 place-items-center rounded-lg border border-border bg-muted font-mono text-[10px] font-bold">
                        {opportunity.symbol.slice(0, 2)}
                      </span>
                      <div>
                        <p className="font-mono text-[13px] font-semibold">
                          {opportunity.symbol}
                        </p>
                        <p className="mt-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                          {opportunity.quotes.length}/2 venues
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-3.5">
                    <VenueRate
                      venue={opportunity.longVenue}
                      rate={opportunity.longRate8h}
                    />
                  </TableCell>
                  <TableCell className="py-3.5">
                    <VenueRate
                      venue={opportunity.shortVenue}
                      rate={opportunity.shortRate8h}
                    />
                  </TableCell>
                  <TableCell className="py-3.5 text-right font-mono text-[12px] font-semibold text-[var(--positive)]">
                    {formatRate(opportunity.spread8h)}
                  </TableCell>
                  <TableCell className="py-3.5 text-right font-mono text-[12px]">
                    {formatRate(opportunity.annualizedSpread)}
                  </TableCell>
                  <TableCell
                    className={`py-3.5 text-right font-mono text-[12px] font-semibold ${estimate.netCarry >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}
                  >
                    {signedMoney(estimate.netCarry)}
                  </TableCell>
                  <TableCell className="px-5 py-3.5 text-right font-mono text-[11px] text-muted-foreground">
                    {opportunity.markDispersionBps === null
                      ? '—'
                      : `${opportunity.markDispersionBps.toFixed(1)} bps`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {!loading && filtered.length === 0 && (
          <div className="px-5 py-14 text-center text-[12px] text-muted-foreground">
            No common funding markets match these filters.
          </div>
        )}
        {filtered.length > 60 && (
          <p className="border-t border-border px-5 py-3 text-[10px] text-muted-foreground">
            Showing the 60 widest spreads. Search a ticker to inspect another
            pair.
          </p>
        )}
      </Panel>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Panel className="p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
            <div>
              <h2 className="text-[13px] font-semibold">
                Execution risk matters
              </h2>
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                Rates can reverse before settlement. Equal notional reduces
                price delta but does not remove basis, slippage, liquidation,
                venue, oracle or transfer risk. Confirm both order books and
                funding clocks before entering either leg.
              </p>
            </div>
          </div>
        </Panel>
        <Panel className="p-5">
          <h2 className="text-[13px] font-semibold">Live data conventions</h2>
          <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
            Robinhood Lighter&apos;s public comparison feed is already
            8-hour-equivalent. Variational&apos;s published percentage-point
            rate is converted to a fractional rate and scaled from its listed
            settlement interval to the same 8-hour basis.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-[10px] font-medium">
            <a
              href="https://github.com/elliottech/lighter-python/blob/main/docs/FundingApi.md"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Lighter API <ExternalLink className="size-3" />
            </a>
            <a
              href="https://docs.variational.io/technical-documentation/api"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Variational API <ExternalLink className="size-3" />
            </a>
          </div>
        </Panel>
      </div>
    </>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  prefix,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max?: number;
  step: number;
  prefix?: string;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5 flex h-10 items-center rounded-lg border border-border bg-background px-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        {prefix && (
          <span className="text-[12px] text-muted-foreground">{prefix}</span>
        )}
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) =>
            onChange(
              Math.min(
                max ?? Number.POSITIVE_INFINITY,
                Math.max(min, Number(event.target.value) || 0),
              ),
            )
          }
          className="min-w-0 flex-1 bg-transparent px-2 font-mono text-[13px] font-semibold outline-none"
        />
        {suffix && (
          <span className="text-[10px] text-muted-foreground">{suffix}</span>
        )}
      </div>
    </label>
  );
}

function SettlementCard({
  quote,
  now,
  lighterHistory,
  tracked,
}: {
  quote: FundingQuote;
  now: number;
  lighterHistory: FundingHistoryPoint[];
  tracked: TrackedSpread[];
}) {
  const nextPayment = nextFundingBoundary(now, quote.intervalSeconds);
  const recentAverage = lighterHistory.length
    ? lighterHistory.reduce((sum, point) => sum + point.nativeRate, 0) /
      lighterHistory.length
    : null;
  const observedMinimum = tracked.length
    ? Math.min(...tracked.map((point) => point.spread8h))
    : null;
  const observedMaximum = tracked.length
    ? Math.max(...tracked.map((point) => point.spread8h))
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold">{quote.venue}</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {quote.venue === 'Robinhood Lighter'
              ? 'Hourly discrete settlement'
              : `${formatInterval(quote.intervalSeconds)} discrete settlement`}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[16px] font-semibold text-primary">
            {formatCountdown(nextPayment - now)}
          </p>
          <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
            estimated next UTC boundary
          </p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/70 pt-3 sm:grid-cols-3">
        <CompactStat
          label="Current native rate"
          value={`${formatRate(quote.nativeRate)} / ${formatInterval(quote.intervalSeconds)}`}
        />
        <CompactStat
          label="8h equivalent"
          value={formatRate(quote.fundingRate8h)}
        />
        {quote.venue === 'Robinhood Lighter' ? (
          <CompactStat
            label="24h settled average"
            value={
              recentAverage === null
                ? 'Loading…'
                : `${formatRate(recentAverage)} / 1h`
            }
          />
        ) : (
          <CompactStat
            label="Observed cross spread"
            value={
              observedMinimum === null || observedMaximum === null
                ? 'Tracking now'
                : tracked.length < 2
                  ? `${formatRate(observedMinimum)} now`
                  : `${formatRate(observedMinimum)}–${formatRate(observedMaximum)}`
            }
          />
        )}
      </div>
      <p className="mt-3 text-[9px] leading-4 text-muted-foreground">
        {quote.venue === 'Robinhood Lighter'
          ? lighterHistory.length
            ? `${lighterHistory.length} settled hourly payments loaded for context; the current rate is not guaranteed.`
            : 'Recent settled payments are loading; the current rate is not guaranteed.'
          : tracked.length > 1
            ? `${tracked.length} live spread observations retained on this device. Variational does not expose settled history in this feed.`
            : 'Live stability tracking starts now and is retained on this device.'}
      </p>
    </div>
  );
}

function ReadinessRow({
  ready,
  label,
  detail,
}: {
  ready: boolean | null;
  label: string;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-2.5 text-[10px]">
      <span
        className={`size-2 rounded-full ${ready === null ? 'bg-[var(--warning)]' : ready ? 'bg-[var(--positive)]' : 'bg-[var(--negative)]'}`}
      />
      <span className="min-w-0 flex-1 text-muted-foreground">{label}</span>
      <span className="shrink-0 font-mono font-semibold text-foreground">
        {detail}
      </span>
    </div>
  );
}

function CheckRow({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[10px] text-muted-foreground">
      <Checkbox checked={checked} onCheckedChange={onCheckedChange} />
      <span>{label}</span>
    </label>
  );
}

function VenueLeg({
  side,
  venue,
  rate,
  icon: Icon,
}: {
  side: 'Long' | 'Short';
  venue: FundingVenue;
  rate: number;
  icon: typeof ArrowDownLeft;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        <Icon className="size-3.5 text-primary" /> {side}
      </div>
      <p className="mt-2 text-[13px] font-semibold">{venue}</p>
      <p className="mt-1 font-mono text-[12px] text-muted-foreground">
        {formatRate(rate)} / 8h
      </p>
    </div>
  );
}

function VenueRate({ venue, rate }: { venue: FundingVenue; rate: number }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-foreground">{venue}</p>
      <p
        className={`mt-0.5 font-mono text-[10px] ${rate >= 0 ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}
      >
        {formatRate(rate)} / 8h
      </p>
    </div>
  );
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-[13px] font-semibold">{value}</p>
    </div>
  );
}

function formatRate(rate: number) {
  const percentage = rate * 100;
  const decimals =
    Math.abs(percentage) >= 100 ? 1 : Math.abs(percentage) >= 1 ? 2 : 4;
  return `${percentage >= 0 ? '+' : ''}${percentage.toFixed(decimals)}%`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function signedMoney(value: number) {
  return `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;
}

function formatDuration(hours: number) {
  if (!Number.isFinite(hours)) return '—';
  if (hours < 1) return `${Math.max(0, hours * 60).toFixed(0)}m`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function formatInterval(seconds: number) {
  const hours = seconds / 3_600;
  return hours < 1
    ? `${Math.round(seconds / 60)}m`
    : `${Number.isInteger(hours) ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}

function formatClock(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}
