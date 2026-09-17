'use client';

import type { LucideIcon } from 'lucide-react';

import type { ValuedHolding } from '@/lib/analytics';
import { formatMoney } from '@/lib/portfolio';

export function PageIntro({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[12px] font-medium text-primary">{eyebrow}</p>
        <h1 className="mt-2 text-[clamp(1.85rem,3vw,2.75rem)] font-semibold tracking-[-0.04em] text-foreground">
          {title}
        </h1>
        <p className="mt-2.5 max-w-3xl text-[14px] leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

export function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = 'default',
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'positive' | 'negative' | 'accent';
}) {
  const accent =
    tone === 'positive'
      ? 'var(--positive)'
      : tone === 'negative'
        ? 'var(--negative)'
        : tone === 'accent'
          ? 'var(--primary)'
          : 'var(--information)';
  return (
    <div
      className={`relative overflow-hidden rounded-xl border p-5 ${tone === 'accent' ? 'border-primary/25 bg-primary/[0.06]' : 'border-border bg-card'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
        <span
          className="grid size-7 shrink-0 place-items-center rounded-lg"
          style={{
            background: `color-mix(in srgb, ${accent} 12%, transparent)`,
            color: accent,
          }}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <p
        className="mt-3 font-mono text-[23px] font-semibold tracking-[-0.04em]"
        style={{ color: tone === 'default' ? 'var(--foreground)' : accent }}
      >
        {value}
      </p>
      <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}

export function Panel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-border bg-card shadow-sm ${className}`}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  description,
  aside,
}: {
  title: string;
  description?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4.5">
      <div>
        <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h2>
        {description && (
          <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {aside}
    </div>
  );
}

export function AssetIdentity({
  holding,
  compact = false,
}: {
  holding: ValuedHolding;
  compact?: boolean;
}) {
  const location =
    holding.network && holding.network !== holding.platform
      ? `${holding.platform} · ${holding.network}`
      : (holding.platform ?? holding.network ?? 'Unknown');
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={`grid shrink-0 place-items-center rounded-lg border border-border font-bold ${compact ? 'size-8 text-[10px]' : 'size-10 text-[12px]'}`}
        style={{
          background: holding.color,
          color: readableTextColor(holding.color),
        }}
      >
        {holding.symbol.slice(0, 1)}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-[14px] font-semibold text-foreground">
            {holding.name}
          </p>
          <PositionBadge holding={holding} />
        </div>
        <p className="mt-1 truncate text-[11px] font-medium text-muted-foreground">
          {holding.symbol} · {location}
        </p>
      </div>
    </div>
  );
}

export function PositionBadge({ holding }: { holding: ValuedHolding }) {
  const perp = holding.positionKind === 'perp';
  const stock = holding.instrumentType === 'stock';
  const staked = holding.assetClass && holding.assetClass !== 'spot';
  const label = perp
    ? `${holding.side} ${holding.leverage ?? 1}×`
    : stock
      ? 'stock'
      : holding.assetClass === 'staked'
        ? 'staked'
        : holding.assetClass === 'unstaking'
          ? 'unlocking'
          : holding.assetClass === 'staking'
            ? 'staking'
            : 'spot';
  const classes = perp
    ? holding.side === 'short'
      ? 'border-destructive/20 bg-destructive/10 text-destructive'
      : 'border-border bg-muted text-[var(--positive)]'
    : stock
      ? 'border-border bg-muted text-[var(--information)]'
      : staked
        ? 'border-border bg-muted text-muted-foreground'
        : 'border-border bg-muted text-muted-foreground';
  return (
    <span
      className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold capitalize ${classes}`}
    >
      {label}
    </span>
  );
}

export function Delta({
  value,
  suffix = '%',
  privacy = false,
}: {
  value: number;
  suffix?: string;
  privacy?: boolean;
}) {
  const positive = value >= 0;
  return (
    <span
      className={`font-mono font-medium ${positive ? 'text-[var(--positive)]' : 'text-[var(--negative)]'}`}
    >
      {privacy ? '••••' : `${positive ? '+' : ''}${value.toFixed(2)}${suffix}`}
    </span>
  );
}

export function Money({
  value,
  privacy,
  compact = false,
  signed = false,
  className = '',
}: {
  value: number;
  privacy: boolean;
  compact?: boolean;
  signed?: boolean;
  className?: string;
}) {
  return (
    <span className={`font-mono ${className}`}>
      {privacy
        ? '••••'
        : `${signed && value >= 0 ? '+' : ''}${formatMoney(value, compact)}`}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-56 place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-12 place-items-center rounded-xl border border-border bg-muted text-muted-foreground">
          <Icon className="size-5" />
        </div>
        <h3 className="mt-4 text-[14px] font-semibold">{title}</h3>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          {description}
        </p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function PrivacyValue({
  children,
  privacy,
}: {
  children: React.ReactNode;
  privacy: boolean;
}) {
  return privacy ? <span className="font-mono">••••</span> : children;
}

function readableTextColor(background: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(background);
  if (!match) return '#080b0e';
  const value = Number.parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return red * 0.299 + green * 0.587 + blue * 0.114 > 145
    ? '#080b0e'
    : '#f7faf7';
}
