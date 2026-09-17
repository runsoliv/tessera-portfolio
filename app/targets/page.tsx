'use client';

import { useState } from 'react';
import {
  Check,
  Crosshair,
  Gauge,
  Plus,
  ShieldCheck,
  Target,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';

import { usePortfolio } from '@/components/portfolio-provider';
import {
  AssetIdentity,
  EmptyState,
  MetricCard,
  PageIntro,
  Panel,
  PanelHeader,
} from '@/components/page-primitives';
import { Button } from '@/components/ui/button';
import { ChartContainer } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import type { ValuedHolding } from '@/lib/analytics';
import { formatMoney } from '@/lib/portfolio';

export default function TargetsPage() {
  const { portfolio, analytics, openAdd, updateHolding } = usePortfolio();
  const privacy = portfolio.privacyMode;
  const targetChange = analytics.totalValue
    ? (analytics.targetDelta / analytics.totalValue) * 100
    : 0;
  const targetCoverage = analytics.holdings.length
    ? (analytics.targetsCount / analytics.holdings.length) * 100
    : 0;
  const scenarioData = [
    { label: 'Current equity', value: analytics.totalValue, fill: '#4b504b' },
    {
      label: 'All targets',
      value: analytics.targetPortfolioValue,
      fill: '#d8ff58',
    },
  ];

  return (
    <>
      <PageIntro
        eyebrow="Scenario analysis"
        title="Price targets"
        description="Set crypto and stock targets plus perpetual take-profit and stop-loss levels, then review the resulting portfolio value and reward-to-risk."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => openAdd('perp')}
              className="h-9 rounded-xl border-white/[0.08] bg-white/[0.02] text-[10px] text-white/55 hover:bg-white/[0.06] hover:text-white"
            >
              <Gauge className="size-3.5" /> Add perp plan
            </Button>
            <Button
              onClick={() => openAdd('spot')}
              className="h-9 rounded-xl bg-[#d8ff58] text-[10px] text-[#090b0b] hover:bg-[#e4ff83]"
            >
              <Plus className="size-3.5" /> Add asset target
            </Button>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={WalletCards}
          label="Current equity"
          value={privacy ? '••••' : formatMoney(analytics.totalValue)}
          detail={`${analytics.holdings.length} total positions`}
        />
        <MetricCard
          icon={Crosshair}
          label="At all targets"
          value={
            analytics.targetsCount
              ? privacy
                ? '••••'
                : formatMoney(analytics.targetPortfolioValue)
              : 'Not modeled'
          }
          detail={
            analytics.targetsCount
              ? `${targetChange >= 0 ? '+' : ''}${targetChange.toFixed(1)}% versus current`
              : 'Enter at least one target'
          }
          tone={
            analytics.targetsCount && targetChange >= 0 ? 'positive' : 'default'
          }
        />
        <MetricCard
          icon={Target}
          label="Target coverage"
          value={`${targetCoverage.toFixed(0)}%`}
          detail={`${analytics.targetsCount}/${analytics.holdings.length} positions have exits`}
          tone="accent"
        />
        <MetricCard
          icon={ShieldCheck}
          label="Perp stop coverage"
          value={`${(analytics.perps.length ? (analytics.stopsCount / analytics.perps.length) * 100 : 0).toFixed(0)}%`}
          detail={`${analytics.stopsCount}/${analytics.perps.length} perps have stop-losses`}
          tone={
            analytics.perps.length > 0 &&
            analytics.stopsCount === analytics.perps.length
              ? 'positive'
              : 'default'
          }
        />
      </section>

      <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Portfolio target bridge"
            description="Assumes every target is reached simultaneously; untargeted positions stay at current marks"
          />
          <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_220px] md:items-center">
            <ChartContainer
              config={{ value: { label: 'Portfolio equity' } }}
              className="h-[185px] w-full aspect-auto"
            >
              <BarChart
                data={scenarioData}
                layout="vertical"
                margin={{ left: 8, right: 16, top: 8, bottom: 8 }}
              >
                <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
                <XAxis hide type="number" />
                <YAxis
                  dataKey="label"
                  type="category"
                  axisLine={false}
                  tickLine={false}
                  width={82}
                  tick={{ fill: 'var(--chart-label)', fontSize: 10 }}
                />
                <Tooltip content={<ScenarioTooltip privacy={privacy} />} />
                <Bar
                  dataKey="value"
                  radius={[0, 5, 5, 0]}
                  background={{ fill: 'var(--muted)' }}
                />
              </BarChart>
            </ChartContainer>
            <div className="rounded-xl border border-[#d8ff58]/14 bg-[#d8ff58]/[0.035] p-4">
              <p className="text-[8px] uppercase tracking-[0.15em] text-white/25">
                Modeled change
              </p>
              <p
                className={`mt-2 font-mono text-xl font-semibold ${analytics.targetDelta >= 0 ? 'text-[#d8ff58]' : 'text-[#ff8585]'}`}
              >
                {analytics.targetsCount
                  ? privacy
                    ? '••••'
                    : `${analytics.targetDelta >= 0 ? '+' : ''}${formatMoney(analytics.targetDelta)}`
                  : '—'}
              </p>
              <p className="mt-1 text-[8px] text-white/28">
                Includes leveraged P&L at each perp take-profit.
              </p>
            </div>
          </div>
        </Panel>

        <Panel className="p-5">
          <div className="flex items-start justify-between">
            <div className="grid size-9 place-items-center rounded-xl bg-[#d8ff58]/10 text-[#d8ff58]">
              <TrendingUp className="size-4" />
            </div>
            <span className="text-[8px] uppercase tracking-[0.15em] text-white/25">
              Perp bracket quality
            </span>
          </div>
          <p className="mt-5 text-[8px] uppercase tracking-[0.15em] text-white/25">
            Portfolio reward : risk
          </p>
          <p className="mt-2 font-mono text-3xl font-semibold tracking-[-0.05em]">
            {analytics.portfolioRiskReward == null
              ? '—'
              : `${analytics.portfolioRiskReward.toFixed(2)} : 1`}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <SmallPlan
              label="Planned reward"
              value={
                privacy
                  ? '••••'
                  : `+${formatMoney(analytics.totalPlannedReward, true)}`
              }
              positive
            />
            <SmallPlan
              label="Planned risk"
              value={
                privacy
                  ? '••••'
                  : `-${formatMoney(analytics.totalPlannedRisk, true).replace('-', '')}`
              }
            />
          </div>
          <p className="mt-4 text-[8px] leading-4 text-white/26">
            Calculated from entry to take-profit versus entry to stop-loss
            across complete perp brackets.
          </p>
        </Panel>
      </section>

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Owned-asset price targets"
          description="Set an independent market-price objective for every crypto or stock holding"
          aside={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openAdd('spot')}
              className="text-[9px] text-[#d8ff58]"
            >
              <Plus className="size-3" /> Add asset
            </Button>
          }
        />
        {analytics.spot.length ? (
          <div className="divide-y divide-white/[0.05]">
            {analytics.spot.map((holding) => (
              <SpotTargetRow
                key={holding.id}
                holding={holding}
                privacy={privacy}
                onSave={(targetPrice) =>
                  updateHolding(holding.id, { targetPrice })
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={WalletCards}
            title="No owned assets"
            description="Add a crypto or stock holding to create a future-value target."
          />
        )}
      </Panel>

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Perpetual take-profit & stop-loss"
          description="Build directional brackets with projected equity and explicit risk"
          aside={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openAdd('perp')}
              className="text-[9px] text-[#d8ff58]"
            >
              <Plus className="size-3" /> Add perpetual
            </Button>
          }
        />
        {analytics.perps.length ? (
          <div className="divide-y divide-white/[0.05]">
            {analytics.perps.map((holding) => (
              <PerpTargetRow
                key={holding.id}
                holding={holding}
                privacy={privacy}
                onSave={(targetPrice, stopLossPrice) =>
                  updateHolding(holding.id, { targetPrice, stopLossPrice })
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Gauge}
            title="No perpetual positions"
            description="Add a perpetual to plan a take-profit, stop-loss and reward-to-risk."
          />
        )}
      </Panel>
    </>
  );
}

function SpotTargetRow({
  holding,
  privacy,
  onSave,
}: {
  holding: ValuedHolding;
  privacy: boolean;
  onSave: (target?: number) => void;
}) {
  const [value, setValue] = useState(
    holding.targetPrice ? String(holding.targetPrice) : '',
  );
  const target = Number(value);
  const valid = !value || (Number.isFinite(target) && target > 0);
  const currentPrice = Number(holding.price ?? holding.manualPrice ?? 0);
  const projectedValue =
    valid && value ? holding.amount * target : holding.value;
  const upside = currentPrice && value ? (target / currentPrice - 1) * 100 : 0;
  return (
    <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(200px,1fr)_160px_130px_130px_90px] lg:items-center">
      <AssetIdentity holding={holding} compact />
      <FieldBlock label="Spot target">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          type="number"
          min="0"
          step="any"
          placeholder="No target"
          className={`h-9 rounded-xl bg-white/[0.025] font-mono text-[9px] ${valid ? 'border-white/[0.08]' : 'border-[#ff7777]/50'}`}
        />
      </FieldBlock>
      <PlanValue
        label="Move required"
        value={
          value && valid
            ? `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%`
            : '—'
        }
        tone={upside >= 0 ? 'positive' : 'negative'}
      />
      <PlanValue
        label="Holding at target"
        value={
          value && valid
            ? privacy
              ? '••••'
              : formatMoney(projectedValue, true)
            : '—'
        }
      />
      <Button
        disabled={!valid}
        onClick={() => onSave(value ? target : undefined)}
        size="sm"
        variant="outline"
        className="h-8 rounded-lg border-white/[0.08] bg-white/[0.02] text-[8px] text-white/50 hover:bg-white/[0.06] hover:text-white"
      >
        <Check className="size-3" /> Save
      </Button>
    </div>
  );
}

function PerpTargetRow({
  holding,
  privacy,
  onSave,
}: {
  holding: ValuedHolding;
  privacy: boolean;
  onSave: (target?: number, stop?: number) => void;
}) {
  const [targetValue, setTargetValue] = useState(
    holding.targetPrice ? String(holding.targetPrice) : '',
  );
  const [stopValue, setStopValue] = useState(
    holding.stopLossPrice ? String(holding.stopLossPrice) : '',
  );
  const target = Number(targetValue);
  const stop = Number(stopValue);
  const entry = Number(holding.entryPrice);
  const long = holding.side !== 'short';
  const targetValid =
    !targetValue ||
    (Number.isFinite(target) &&
      target > 0 &&
      (long ? target > entry : target < entry));
  const stopValid =
    !stopValue ||
    (Number.isFinite(stop) && stop > 0 && (long ? stop < entry : stop > entry));
  const direction = long ? 1 : -1;
  const reward =
    targetValue && targetValid
      ? Math.max(0, direction * holding.amount * (target - entry))
      : 0;
  const risk =
    stopValue && stopValid
      ? Math.abs(direction * holding.amount * (stop - entry))
      : 0;
  const projectedEquity =
    targetValue && targetValid
      ? holding.margin + direction * holding.amount * (target - entry)
      : holding.value;
  return (
    <div className="grid gap-4 px-5 py-4 xl:grid-cols-[minmax(190px,1fr)_135px_135px_105px_105px_90px] xl:items-center">
      <AssetIdentity holding={holding} compact />
      <FieldBlock label="Take-profit">
        <Input
          value={targetValue}
          onChange={(event) => setTargetValue(event.target.value)}
          type="number"
          min="0"
          step="any"
          placeholder={long ? 'Above entry' : 'Below entry'}
          className={`h-9 rounded-xl bg-white/[0.025] font-mono text-[9px] ${targetValid ? 'border-white/[0.08]' : 'border-[#ff7777]/50'}`}
        />
      </FieldBlock>
      <FieldBlock label="Stop-loss">
        <Input
          value={stopValue}
          onChange={(event) => setStopValue(event.target.value)}
          type="number"
          min="0"
          step="any"
          placeholder={long ? 'Below entry' : 'Above entry'}
          className={`h-9 rounded-xl bg-white/[0.025] font-mono text-[9px] ${stopValid ? 'border-white/[0.08]' : 'border-[#ff7777]/50'}`}
        />
      </FieldBlock>
      <PlanValue
        label="Reward / risk"
        value={reward && risk ? `${(reward / risk).toFixed(2)} : 1` : '—'}
        tone={reward / risk >= 1.5 ? 'positive' : 'default'}
      />
      <PlanValue
        label="Equity at TP"
        value={
          targetValue && targetValid
            ? privacy
              ? '••••'
              : formatMoney(projectedEquity, true)
            : '—'
        }
      />
      <Button
        disabled={!targetValid || !stopValid}
        onClick={() =>
          onSave(targetValue ? target : undefined, stopValue ? stop : undefined)
        }
        size="sm"
        variant="outline"
        className="h-8 rounded-lg border-white/[0.08] bg-white/[0.02] text-[8px] text-white/50 hover:bg-white/[0.06] hover:text-white"
      >
        <Check className="size-3" /> Save
      </Button>
    </div>
  );
}

function FieldBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="mb-1.5 block text-[7px] uppercase tracking-[0.13em] text-white/22">
        {label}
      </span>
      {children}
    </label>
  );
}
function PlanValue({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  return (
    <div>
      <p className="text-[7px] uppercase tracking-[0.13em] text-white/22">
        {label}
      </p>
      <p
        className={`mt-1.5 font-mono text-[9px] font-medium ${tone === 'positive' ? 'text-[#d8ff58]' : tone === 'negative' ? 'text-[#ff8585]' : 'text-white/58'}`}
      >
        {value}
      </p>
    </div>
  );
}
function SmallPlan({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
      <p className="text-[7px] uppercase tracking-[0.13em] text-white/22">
        {label}
      </p>
      <p
        className={`mt-2 font-mono text-[10px] font-medium ${positive ? 'text-[#d8ff58]' : 'text-[#ff8585]'}`}
      >
        {value}
      </p>
    </div>
  );
}

function ScenarioTooltip({
  active,
  payload,
  privacy,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { label?: string }; value?: number }>;
  privacy: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-lg">
      <p className="text-[8px] text-muted-foreground">
        {payload[0].payload?.label}
      </p>
      <p className="mt-1 font-mono text-[10px] font-semibold">
        {privacy ? '••••' : formatMoney(Number(payload[0].value))}
      </p>
    </div>
  );
}
