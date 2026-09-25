'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Calculator,
  Clock3,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
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
  type FundingOpportunity,
  type FundingVenue,
} from '@/lib/funding-arb';

type FundingResponse = {
  fetchedAt: number;
  opportunities: FundingOpportunity[];
  sources: { venue: FundingVenue; markets: number }[];
  warnings: string[];
};

export default function FundingArbPage() {
  const [data, setData] = useState<FundingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [threeVenuesOnly, setThreeVenuesOnly] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [notionalPerLeg, setNotionalPerLeg] = useState(10_000);
  const [holdHours, setHoldHours] = useState(24);
  const [costBpsPerFill, setCostBpsPerFill] = useState(2);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/funding-arb', { cache: 'no-store' });
      if (!response.ok)
        throw new Error(`Funding feed returned ${response.status}`);
      const nextData = (await response.json()) as FundingResponse;
      setData(nextData);
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

  const filtered = useMemo(() => {
    const search = query.trim().toUpperCase();
    return (data?.opportunities ?? []).filter(
      (opportunity) =>
        (!search || opportunity.symbol.includes(search)) &&
        (!threeVenuesOnly || opportunity.quotes.length === 3),
    );
  }, [data?.opportunities, query, threeVenuesOnly]);
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
  const profitableCount = filtered.filter(
    (opportunity) =>
      estimateFundingCarry({
        opportunity,
        notionalPerLeg,
        holdHours,
        executionCostBpsPerFill: costBpsPerFill,
      }).netCarry > 0,
  ).length;

  return (
    <>
      <PageIntro
        eyebrow="Live cross-venue scanner"
        title="Funding rate arbitrage"
        description="Compare matching perpetuals on Lighter, Robinhood Lighter and Variational. Rates are normalized to an 8-hour basis, then translated into a two-leg carry estimate."
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
                    : 'Try showing pairs available on any two venues.'}
                </p>
              </div>
            </div>
          )}
        </div>
      </Panel>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={ArrowLeftRight}
          label="Common pairs"
          value={String(filtered.length)}
          detail={
            threeVenuesOnly
              ? 'Listed on all three venues'
              : 'Listed on at least two venues'
          }
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
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
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
          <div className="flex rounded-lg border border-border bg-muted/60 p-1">
            <Button
              type="button"
              size="sm"
              variant={!threeVenuesOnly ? 'secondary' : 'ghost'}
              onClick={() => setThreeVenuesOnly(false)}
              className="rounded-md"
            >
              Any 2 venues
            </Button>
            <Button
              type="button"
              size="sm"
              variant={threeVenuesOnly ? 'secondary' : 'ghost'}
              onClick={() => setThreeVenuesOnly(true)}
              className="rounded-md"
            >
              All 3 venues
            </Button>
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
                          {opportunity.quotes.length}/3 venues
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
            Lighter&apos;s public comparison feed is already 8-hour-equivalent.
            Variational&apos;s published percentage-point rate is converted to a
            fractional rate and scaled from its listed settlement interval to
            the same 8-hour basis.
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
  step,
  prefix,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
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
          step={step}
          onChange={(event) =>
            onChange(Math.max(min, Number(event.target.value) || 0))
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

function formatClock(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}
