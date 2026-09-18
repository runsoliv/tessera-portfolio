'use client';

import { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CircleDollarSign,
  RotateCcw,
  Trophy,
} from 'lucide-react';

import { usePortfolio } from '@/components/portfolio-provider';
import { MetricCard, PageIntro, Panel } from '@/components/page-primitives';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/portfolio';
import {
  buildDailyPortfolioPnlHistory,
  buildPortfolioPnlHistory,
  type DailyPortfolioPnlPoint,
} from '@/lib/venue-history';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UTC_DAY = 86_400_000;

type CalendarDay = {
  key: string;
  day: number;
  timestamp: number;
  point: DailyPortfolioPnlPoint | null;
  inMonth: boolean;
  isToday: boolean;
};

type CalendarWeek = {
  days: CalendarDay[];
  pnl: number;
  trackedDays: number;
};

export default function PnlCalendarPage() {
  const { portfolio, analytics } = usePortfolio();
  const [today] = useState(() => Date.now());
  const currentMonth = startOfUtcMonth(today);
  const [monthCursor, setMonthCursor] = useState(currentMonth);
  const privacy = portfolio.privacyMode;

  const dailyHistory = useMemo(() => {
    const cumulative = buildPortfolioPnlHistory(
      portfolio.snapshots,
      portfolio.venueHistories ?? [],
      analytics.totalValue,
    );
    return buildDailyPortfolioPnlHistory(cumulative);
  }, [analytics.totalValue, portfolio.snapshots, portfolio.venueHistories]);

  const calendar = useMemo(
    () => buildCalendarMonth(monthCursor, dailyHistory, today),
    [dailyHistory, monthCursor, today],
  );
  const isCurrentMonth = monthCursor === currentMonth;
  const monthLabel = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(monthCursor);
  const directionTone =
    calendar.total > 0
      ? 'positive'
      : calendar.total < 0
        ? 'negative'
        : 'default';

  function moveMonth(delta: number) {
    setMonthCursor((current) => {
      const date = new Date(current);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1);
    });
  }

  return (
    <>
      <PageIntro
        eyebrow="Performance journal"
        title="P&L calendar"
        description="A clean UTC-day view of whole-portfolio performance. Deposits, withdrawals and imported positions are excluded by the transfer-adjusted history model."
        actions={
          <div className="flex items-center rounded-lg border border-border bg-card p-1 shadow-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => moveMonth(-1)}
              aria-label="Previous month"
              className="rounded-md text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMonthCursor(currentMonth)}
              className="h-8 min-w-32 rounded-md px-3 text-[12px] font-semibold"
            >
              {isCurrentMonth ? 'This month' : monthLabel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => moveMonth(1)}
              disabled={isCurrentMonth}
              aria-label="Next month"
              className="rounded-md text-muted-foreground hover:text-foreground"
            >
              <ArrowRight className="size-4" />
            </Button>
          </div>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={CircleDollarSign}
          label={`${monthLabel} P&L`}
          value={privacy ? '••••' : signedMoney(calendar.total)}
          detail={`${calendar.trackedDays} tracked UTC day${calendar.trackedDays === 1 ? '' : 's'}`}
          tone={directionTone}
        />
        <MetricCard
          icon={Trophy}
          label="Win rate"
          value={`${calendar.winRate.toFixed(0)}%`}
          detail={`${calendar.positiveDays} green · ${calendar.negativeDays} red`}
          tone={calendar.winRate >= 50 ? 'positive' : 'default'}
        />
        <MetricCard
          icon={ArrowUpRight}
          label="Best day"
          value={
            privacy
              ? '••••'
              : calendar.best
                ? signedMoney(calendar.best.value)
                : '—'
          }
          detail={
            calendar.best
              ? formatUtcDate(calendar.best.timestamp)
              : 'No tracked result'
          }
          tone="positive"
        />
        <MetricCard
          icon={ArrowDownRight}
          label="Worst day"
          value={
            privacy
              ? '••••'
              : calendar.worst
                ? signedMoney(calendar.worst.value)
                : '—'
          }
          detail={
            calendar.worst
              ? formatUtcDate(calendar.worst.timestamp)
              : 'No tracked result'
          }
          tone="negative"
        />
      </section>

      <Panel className="mt-4 overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <CalendarDays className="size-4 text-primary" />
              <h2 className="text-[18px] font-semibold tracking-[-0.025em]">
                {monthLabel}
              </h2>
            </div>
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              Every session closes at 00:00 UTC · weekly totals exclude blank
              days
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-[11px] font-medium text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm bg-[var(--positive)]" />{' '}
              Profit
            </span>
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm bg-[var(--negative)]" /> Loss
            </span>
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm border border-border bg-muted" />{' '}
              No data
            </span>
          </div>
        </div>

        <div className="overflow-x-auto p-3 sm:p-5">
          <div className="min-w-[850px]">
            <div className="grid grid-cols-[repeat(7,minmax(92px,1fr))_132px] gap-2 px-0.5 pb-2">
              {DAY_LABELS.map((day) => (
                <div
                  key={day}
                  className="px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                >
                  {day}
                </div>
              ))}
              <div className="px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                Week
              </div>
            </div>

            <div className="space-y-2">
              {calendar.weeks.map((week, weekIndex) => (
                <div
                  key={`${monthCursor}-${weekIndex}`}
                  className="grid grid-cols-[repeat(7,minmax(92px,1fr))_132px] gap-2"
                >
                  {week.days.map((day) => (
                    <CalendarCell
                      key={day.key}
                      day={day}
                      maxMagnitude={calendar.maxMagnitude}
                      privacy={privacy}
                    />
                  ))}
                  <div className="flex min-h-28 flex-col justify-between rounded-lg border border-border bg-muted/35 p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
                      Week {weekIndex + 1}
                    </p>
                    <div>
                      <p
                        className={`font-mono text-[17px] font-semibold tracking-[-0.035em] ${pnlColor(week.pnl)}`}
                      >
                        {privacy
                          ? '••••'
                          : week.trackedDays
                            ? signedMoney(week.pnl)
                            : '—'}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {week.trackedDays} tracked day
                        {week.trackedDays === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>

      <section className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-[16px] font-semibold tracking-[-0.02em]">
                Weekly pace
              </h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Month-to-date results grouped into calendar weeks
              </p>
            </div>
            <span className="rounded-md border border-border bg-muted px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
              avg {privacy ? '••••' : signedMoney(calendar.average)} / day
            </span>
          </div>
          <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
            {calendar.weeks.map((week, index) => (
              <div key={index} className="bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    Week {index + 1}
                  </p>
                  <span
                    className={`size-2 rounded-full ${week.pnl > 0 ? 'bg-[var(--positive)]' : week.pnl < 0 ? 'bg-[var(--negative)]' : 'bg-muted-foreground/40'}`}
                  />
                </div>
                <p
                  className={`mt-3 font-mono text-[21px] font-semibold ${pnlColor(week.pnl)}`}
                >
                  {privacy
                    ? '••••'
                    : week.trackedDays
                      ? signedMoney(week.pnl)
                      : '—'}
                </p>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {week.trackedDays} day{week.trackedDays === 1 ? '' : 's'}{' '}
                  recorded
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-[16px] font-semibold tracking-[-0.02em]">
                Month quality
              </h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Consistency across recorded UTC sessions
              </p>
            </div>
            {!isCurrentMonth && (
              <button
                type="button"
                onClick={() => setMonthCursor(currentMonth)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:opacity-75"
              >
                <RotateCcw className="size-3.5" /> Current
              </button>
            )}
          </div>
          <div className="space-y-5 p-5">
            <QualityRow
              label="Profitable sessions"
              value={calendar.positiveDays}
              total={calendar.decisionDays}
              color="var(--positive)"
            />
            <QualityRow
              label="Losing sessions"
              value={calendar.negativeDays}
              total={calendar.decisionDays}
              color="var(--negative)"
            />
            <QualityRow
              label="Tracked coverage"
              value={calendar.trackedDays}
              total={daysElapsedInMonth(monthCursor, today)}
              color="var(--information)"
            />
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Green / red
                </p>
                <p className="mt-2 font-mono text-[16px] font-semibold">
                  {calendar.positiveDays} / {calendar.negativeDays}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Net average
                </p>
                <p
                  className={`mt-2 font-mono text-[16px] font-semibold ${pnlColor(calendar.average)}`}
                >
                  {privacy ? '••••' : signedMoney(calendar.average)}
                </p>
              </div>
            </div>
          </div>
        </Panel>
      </section>
    </>
  );
}

function CalendarCell({
  day,
  maxMagnitude,
  privacy,
}: {
  day: CalendarDay;
  maxMagnitude: number;
  privacy: boolean;
}) {
  if (!day.inMonth)
    return (
      <div className="min-h-28 rounded-lg border border-dashed border-border/60 bg-muted/10" />
    );

  const value = day.point?.value;
  const hasValue = Number.isFinite(value);
  const intensity = hasValue
    ? Math.min(1, Math.abs(Number(value)) / Math.max(1, maxMagnitude))
    : 0;
  const positive = Number(value) >= 0;
  const tone = positive ? 'var(--positive)' : 'var(--negative)';
  const background = hasValue
    ? `color-mix(in srgb, ${tone} ${Math.round(10 + intensity * 24)}%, var(--card))`
    : 'var(--card)';
  const border = hasValue
    ? `color-mix(in srgb, ${tone} ${Math.round(28 + intensity * 38)}%, var(--border))`
    : 'var(--border)';

  return (
    <div
      className={`relative flex min-h-28 flex-col justify-between overflow-hidden rounded-lg border p-3 transition hover:-translate-y-0.5 hover:shadow-md ${day.isToday ? 'ring-2 ring-primary/45 ring-offset-1 ring-offset-background' : ''}`}
      style={{ background, borderColor: border }}
      title={
        hasValue
          ? `${formatUtcDate(day.timestamp)}: ${signedMoney(Number(value))}`
          : `${formatUtcDate(day.timestamp)}: no recorded close`
      }
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`font-mono text-[12px] font-semibold ${day.isToday ? 'text-primary' : 'text-muted-foreground'}`}
        >
          {day.day}
        </span>
        {day.isToday && (
          <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-primary">
            Today
          </span>
        )}
      </div>
      <div>
        <p
          className={`font-mono text-[16px] font-semibold tracking-[-0.035em] ${hasValue ? pnlColor(Number(value)) : 'text-muted-foreground/60'}`}
        >
          {privacy
            ? hasValue
              ? '••••'
              : '—'
            : hasValue
              ? signedMoney(Number(value))
              : '—'}
        </p>
        <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {hasValue ? (day.point?.origin ?? 'tracked') : 'no close'}
        </p>
      </div>
    </div>
  );
}

function QualityRow({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4 text-[12px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        <span className="font-mono font-semibold text-foreground">
          {value}/{total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${percentage}%`, background: color }}
        />
      </div>
    </div>
  );
}

function buildCalendarMonth(
  monthStart: number,
  dailyHistory: DailyPortfolioPnlPoint[],
  today: number,
) {
  const cursor = new Date(monthStart);
  const year = cursor.getUTCFullYear();
  const month = cursor.getUTCMonth();
  const firstWeekday = cursor.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const rowCount = Math.ceil((firstWeekday + daysInMonth) / 7);
  const historyByDay = new Map(
    dailyHistory.map((point) => [utcDayKey(point.timestamp), point]),
  );
  const todayKey = utcDayKey(today);
  const gridStart = monthStart - firstWeekday * UTC_DAY;
  const days = Array.from({ length: rowCount * 7 }, (_, index): CalendarDay => {
    const timestamp = gridStart + index * UTC_DAY;
    const date = new Date(timestamp);
    const inMonth =
      date.getUTCFullYear() === year && date.getUTCMonth() === month;
    const key = utcDayKey(timestamp);
    return {
      key,
      day: date.getUTCDate(),
      timestamp,
      point: inMonth ? (historyByDay.get(key) ?? null) : null,
      inMonth,
      isToday: key === todayKey,
    };
  });
  const weeks: CalendarWeek[] = Array.from({ length: rowCount }, (_, index) => {
    const weekDays = days.slice(index * 7, index * 7 + 7);
    const values = weekDays.flatMap((day) =>
      day.point && Number.isFinite(day.point.value) ? [day.point.value] : [],
    );
    return {
      days: weekDays,
      pnl: values.reduce((sum, value) => sum + value, 0),
      trackedDays: values.length,
    };
  });
  const points = days.flatMap((day) => (day.point ? [day.point] : []));
  const decisionPoints = points.filter(
    (point) => Math.abs(point.value) >= 0.005,
  );
  const positiveDays = decisionPoints.filter((point) => point.value > 0).length;
  const negativeDays = decisionPoints.filter((point) => point.value < 0).length;
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const best = points.length
    ? points.reduce((current, point) =>
        point.value > current.value ? point : current,
      )
    : null;
  const worst = points.length
    ? points.reduce((current, point) =>
        point.value < current.value ? point : current,
      )
    : null;

  return {
    weeks,
    total,
    trackedDays: points.length,
    positiveDays,
    negativeDays,
    decisionDays: decisionPoints.length,
    winRate: decisionPoints.length
      ? (positiveDays / decisionPoints.length) * 100
      : 0,
    average: points.length ? total / points.length : 0,
    best,
    worst,
    maxMagnitude: Math.max(1, ...points.map((point) => Math.abs(point.value))),
  };
}

function startOfUtcMonth(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function utcDayKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function daysElapsedInMonth(monthStart: number, today: number) {
  const date = new Date(monthStart);
  const currentMonth = startOfUtcMonth(today);
  if (monthStart === currentMonth) return new Date(today).getUTCDate();
  if (monthStart > currentMonth) return 0;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function formatUtcDate(timestamp: number) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(timestamp);
}

function signedMoney(value: number) {
  return `${value >= 0 ? '+' : ''}${formatMoney(value, Math.abs(value) >= 10_000)}`;
}

function pnlColor(value: number) {
  return value > 0
    ? 'text-[var(--positive)]'
    : value < 0
      ? 'text-[var(--negative)]'
      : 'text-foreground';
}
