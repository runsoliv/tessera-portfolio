'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Gauge,
  Pencil,
  Plus,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';

import { usePortfolio } from '@/components/portfolio-provider';
import {
  AssetIdentity,
  EmptyState,
  MetricCard,
  Money,
  PageIntro,
  Panel,
  PanelHeader,
} from '@/components/page-primitives';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/portfolio';

export default function MarginPage() {
  const { portfolio, analytics, openAdd, openEdit } = usePortfolio();
  const [shock, setShock] = useState(-10);
  const privacy = portfolio.privacyMode;

  const stress = useMemo(() => {
    const move = shock / 100;
    const spotValue = analytics.spotValue * (1 + move);
    const perpDelta = analytics.perps.reduce(
      (sum, holding) =>
        sum + (holding.side === 'short' ? -1 : 1) * holding.notional * move,
      0,
    );
    const perpEquity = analytics.perpEquity + perpDelta;
    const liquidations = analytics.perps.filter((holding) => {
      const current = Number(holding.price ?? holding.manualPrice ?? 0);
      if (!current || holding.liquidationPrice == null) return false;
      const projected = current * (1 + move);
      return holding.side === 'short'
        ? projected >= Number(holding.liquidationPrice)
        : projected <= Number(holding.liquidationPrice);
    });
    return {
      spotValue,
      perpEquity,
      total: spotValue + perpEquity,
      perpDelta,
      liquidations,
    };
  }, [analytics, shock]);

  const longNotional = analytics.perps
    .filter((holding) => holding.side !== 'short')
    .reduce((sum, holding) => sum + holding.notional, 0);
  const shortNotional = analytics.perps
    .filter((holding) => holding.side === 'short')
    .reduce((sum, holding) => sum + holding.notional, 0);
  const totalDirectional = longNotional + shortNotional;
  const perpReturn = analytics.marginUsed
    ? (analytics.perpPnl / analytics.marginUsed) * 100
    : 0;

  return (
    <>
      <PageIntro
        eyebrow="Risk management"
        title="Margin and leverage"
        description="Monitor contract collateral, notional exposure, return on equity and venue-reported liquidation levels."
        actions={
          <Button
            onClick={() => openAdd('perp')}
            className="h-9 rounded-xl bg-[#d8ff58] text-[10px] text-[#090b0b] hover:bg-[#e4ff83]"
          >
            <Plus className="size-3.5" /> Enter perpetual
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={TrendingUp}
          label="Perp notional"
          value={privacy ? '••••' : formatMoney(analytics.perpNotional)}
          detail={`${analytics.perps.length} open contract${analytics.perps.length === 1 ? '' : 's'}`}
        />
        <MetricCard
          icon={Gauge}
          label="Margin used"
          value={privacy ? '••••' : formatMoney(analytics.marginUsed)}
          detail={`${analytics.marginUtilization.toFixed(1)}% of leverage equity`}
        />
        <MetricCard
          icon={analytics.perpPnl >= 0 ? ArrowUpRight : ArrowDownRight}
          label="Unrealized perp P&L"
          value={
            privacy
              ? '••••'
              : `${analytics.perpPnl >= 0 ? '+' : ''}${formatMoney(analytics.perpPnl)}`
          }
          detail={`${perpReturn >= 0 ? '+' : ''}${perpReturn.toFixed(1)}% return on margin`}
          tone={analytics.perpPnl >= 0 ? 'positive' : 'negative'}
        />
        <MetricCard
          icon={ShieldAlert}
          label="Effective leverage"
          value={`${analytics.effectiveLeverage.toFixed(2)}×`}
          detail={
            analytics.nearestLiquidation
              ? `${Number(analytics.nearestLiquidation.liquidationDistance).toFixed(1)}% to nearest estimate`
              : 'No liquidation exposure'
          }
          tone={
            analytics.nearestLiquidation &&
            Number(analytics.nearestLiquidation.liquidationDistance) < 15
              ? 'negative'
              : 'accent'
          }
        />
      </section>

      <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Open perpetuals"
            description="Position risk from your inputs and venue snapshots, updated with live marks"
            aside={
              <span className="rounded-full border border-white/[0.07] px-2 py-1 text-[7px] uppercase tracking-[0.14em] text-white/28">
                {analytics.stopsCount}/{analytics.perps.length} with stops
              </span>
            }
          />
          {analytics.perps.length ? (
            <div className="divide-y divide-white/[0.05]">
              {analytics.perps.map((holding) => {
                const pnl = Number(holding.unrealizedPnl ?? 0);
                const hasLiquidation = holding.liquidationPrice != null;
                const danger =
                  hasLiquidation && Number(holding.liquidationDistance) < 15;
                return (
                  <button
                    key={holding.id}
                    aria-label={`Edit ${holding.symbol} perpetual`}
                    onClick={() => openEdit(holding)}
                    className="grid w-full gap-4 px-5 py-4 text-left transition hover:bg-white/[0.022] md:grid-cols-[minmax(180px,1fr)_repeat(4,minmax(95px,.62fr))_24px] md:items-center"
                  >
                    <AssetIdentity holding={holding} compact />
                    <RiskCell
                      label="Notional / margin"
                      value={
                        privacy ? '••••' : formatMoney(holding.notional, true)
                      }
                      detail={
                        privacy
                          ? 'Hidden'
                          : `${formatMoney(holding.margin, true)} margin`
                      }
                    />
                    <RiskCell
                      label="Unrealized / ROE"
                      value={
                        privacy
                          ? '••••'
                          : `${pnl >= 0 ? '+' : ''}${formatMoney(pnl, true)}`
                      }
                      detail={`${Number(holding.roe).toFixed(1)}% ROE`}
                      tone={pnl >= 0 ? 'positive' : 'negative'}
                    />
                    <RiskCell
                      label={
                        holding.liquidationModel === 'reported-only'
                          ? 'Venue liquidation'
                          : 'Liquidation est.'
                      }
                      value={
                        privacy
                          ? '••••'
                          : hasLiquidation
                            ? formatMoney(Number(holding.liquidationPrice))
                            : 'Account-level'
                      }
                      detail={
                        hasLiquidation
                          ? `${Number(holding.liquidationDistance).toFixed(1)}% from mark`
                          : 'Not reported per position'
                      }
                      tone={danger ? 'negative' : 'default'}
                    />
                    <RiskCell
                      label="Bracket"
                      value={
                        holding.targetPrice
                          ? `TP ${privacy ? '••••' : formatMoney(holding.targetPrice)}`
                          : 'No take-profit'
                      }
                      detail={
                        holding.stopLossPrice
                          ? `SL ${privacy ? '••••' : formatMoney(holding.stopLossPrice)}`
                          : 'No stop-loss'
                      }
                      tone={!holding.stopLossPrice ? 'negative' : 'default'}
                    />
                    <Pencil className="size-3.5 text-white/20" />
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Gauge}
              title="No perpetual positions"
              description="Enter a long or short contract to activate margin, leverage and liquidation analytics."
              action={
                <Button
                  onClick={() => openAdd('perp')}
                  className="bg-[#d8ff58] text-[#090b0b] hover:bg-[#e4ff83]"
                >
                  <Plus className="size-3.5" /> Enter perpetual
                </Button>
              }
            />
          )}
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader
            title="Directional exposure"
            description="Long versus short notional"
          />
          <div className="p-5">
            <div className="flex h-3 overflow-hidden rounded-full bg-white/[0.04]">
              {totalDirectional > 0 && (
                <>
                  <div
                    className="h-full bg-[#d8ff58]"
                    style={{
                      width: `${(longNotional / totalDirectional) * 100}%`,
                    }}
                  />
                  <div
                    className="h-full bg-[#ff7777]"
                    style={{
                      width: `${(shortNotional / totalDirectional) * 100}%`,
                    }}
                  />
                </>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ExposureCard
                label="Long notional"
                value={longNotional}
                total={totalDirectional}
                color="#d8ff58"
                privacy={privacy}
              />
              <ExposureCard
                label="Short notional"
                value={shortNotional}
                total={totalDirectional}
                color="#ff7777"
                privacy={privacy}
              />
            </div>
            <div className="mt-5 rounded-xl border border-white/[0.06] bg-black/15 p-4">
              <p className="text-[8px] uppercase tracking-[0.15em] text-white/25">
                Net directional exposure
              </p>
              <p className="mt-2 font-mono text-lg font-semibold">
                {privacy ? '••••' : formatMoney(analytics.netExposure)}
              </p>
              <p className="mt-1 text-[8px] text-white/28">
                Includes owned spot as long exposure.
              </p>
            </div>
          </div>
        </Panel>
      </section>

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Portfolio stress test"
          description="Move all tracked market prices together and estimate the resulting equity and liquidation events"
          aside={
            <span
              className={`font-mono text-[11px] font-semibold ${shock >= 0 ? 'text-[#d8ff58]' : 'text-[#ff8585]'}`}
            >
              {shock >= 0 ? '+' : ''}
              {shock}%
            </span>
          }
        />
        <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_repeat(3,minmax(130px,.34fr))] lg:items-center">
          <div>
            <input
              aria-label="Stress test market move"
              type="range"
              min="-50"
              max="50"
              step="1"
              value={shock}
              onChange={(event) => setShock(Number(event.target.value))}
              className="stress-slider w-full"
            />
            <div className="mt-2 flex justify-between text-[7px] text-white/20">
              <span>-50%</span>
              <button onClick={() => setShock(0)} className="hover:text-white">
                Reset
              </button>
              <span>+50%</span>
            </div>
          </div>
          <StressCell
            label="Stressed equity"
            value={privacy ? '••••' : formatMoney(stress.total)}
            delta={stress.total - analytics.totalValue}
            privacy={privacy}
          />
          <StressCell
            label="Perp P&L impact"
            value={
              privacy
                ? '••••'
                : `${stress.perpDelta >= 0 ? '+' : ''}${formatMoney(stress.perpDelta)}`
            }
            delta={stress.perpDelta}
            privacy={privacy}
          />
          <div
            className={`rounded-xl border p-3 ${stress.liquidations.length ? 'border-[#ff7777]/20 bg-[#ff7777]/[0.055]' : 'border-[#d8ff58]/14 bg-[#d8ff58]/[0.035]'}`}
          >
            <p className="text-[7px] uppercase tracking-[0.14em] text-white/25">
              Estimated liquidations
            </p>
            <p
              className={`mt-2 font-mono text-[13px] font-semibold ${stress.liquidations.length ? 'text-[#ff8585]' : 'text-[#d8ff58]'}`}
            >
              {stress.liquidations.length}
            </p>
            <p className="mt-1 text-[8px] text-white/25">
              {stress.liquidations.length
                ? stress.liquidations
                    .map((holding) => `${holding.symbol} ${holding.side}`)
                    .join(', ')
                : 'None at this shock'}
            </p>
          </div>
        </div>
      </Panel>

      <div className="mt-3 flex items-start gap-3 rounded-2xl border border-[#ffd166]/12 bg-[#ffd166]/[0.025] px-4 py-3">
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#ffd166]/70" />
        <p className="text-[8px] leading-4 text-white/28">
          Imported liquidation prices are shown only when the venue reports one.
          Manual-position estimates use entered collateral and maintenance
          margin; funding, fees, tiered rates and cross-margin offsets are not
          included.
        </p>
      </div>
    </>
  );
}

function RiskCell({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  return (
    <div>
      <p className="text-[7px] uppercase tracking-[0.13em] text-white/20">
        {label}
      </p>
      <p
        className={`mt-1.5 font-mono text-[9px] font-medium ${tone === 'positive' ? 'text-[#d8ff58]' : tone === 'negative' ? 'text-[#ff8585]' : 'text-white/62'}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[8px] text-white/24">{detail}</p>
    </div>
  );
}

function ExposureCard({
  label,
  value,
  total,
  color,
  privacy,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  privacy: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[8px] text-white/28">
        <span className="size-1.5 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <p className="mt-2 font-mono text-[11px] font-medium">
        {privacy ? '••••' : formatMoney(value, true)}
      </p>
      <p className="mt-1 text-[8px] text-white/22">
        {total ? ((value / total) * 100).toFixed(1) : '0.0'}%
      </p>
    </div>
  );
}

function StressCell({
  label,
  value,
  delta,
  privacy,
}: {
  label: string;
  value: string;
  delta: number;
  privacy: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[7px] uppercase tracking-[0.14em] text-white/22">
        {label}
      </p>
      <p className="mt-2 font-mono text-[12px] font-semibold">{value}</p>
      <p
        className={`mt-1 text-[8px] ${delta >= 0 ? 'text-[#d8ff58]/65' : 'text-[#ff8585]/70'}`}
      >
        <Money value={delta} privacy={privacy} compact signed />
      </p>
    </div>
  );
}
