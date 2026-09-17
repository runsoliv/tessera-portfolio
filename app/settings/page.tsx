'use client';

import { useMemo, useRef, useState } from 'react';
import {
  Check,
  Database,
  Download,
  EyeOff,
  FileJson,
  FileUp,
  HardDrive,
  Radio,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';

import {
  MetricCard,
  PageIntro,
  Panel,
  PanelHeader,
} from '@/components/page-primitives';
import { usePortfolio } from '@/components/portfolio-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

type ConfirmAction = 'clear' | 'sample' | null;

const providers = [
  {
    name: 'CoinGecko',
    role: 'Primary market pricing',
    description: 'Mainstream assets, 24h change, volume and market cap.',
  },
  {
    name: 'Coinbase',
    role: 'Symbol fallback',
    description:
      'Backup USD exchange rate when the primary quote is unavailable.',
  },
  {
    name: 'DEX Screener',
    role: 'Onchain pricing',
    description:
      'Contract-address pricing across supported decentralized networks.',
  },
  {
    name: 'Yahoo Finance',
    role: 'Stock & ETF pricing',
    description:
      'US-listed ticker search, market prices, daily change and trading volume.',
  },
];

export default function SettingsPage() {
  const {
    portfolio,
    analytics,
    importProfiles,
    refreshState,
    refreshPrices,
    setPrivacyMode,
    setAutoRefresh,
    setMinimumPositionValue,
    exportPortfolio,
    importPortfolio,
    resetSample,
    startFresh,
  } = usePortfolio();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [importing, setImporting] = useState(false);

  const storageSize = useMemo(() => {
    const bytes = new Blob([JSON.stringify({ portfolio, importProfiles })])
      .size;
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  }, [importProfiles, portfolio]);

  const sources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const holding of analytics.holdings) {
      const provider =
        holding.provider ??
        (holding.source === 'manual' ? 'Manual' : 'Waiting for quote');
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return Array.from(counts, ([provider, count]) => ({
      provider,
      count,
    })).sort((a, b) => b.count - a.count);
  }, [analytics.holdings]);

  async function handleFile(file: File) {
    setImporting(true);
    await importPortfolio(file);
    setImporting(false);
  }

  function runConfirmedAction() {
    if (confirmAction === 'clear') startFresh();
    if (confirmAction === 'sample') resetSample();
    setConfirmAction(null);
  }

  return (
    <>
      <PageIntro
        eyebrow="Application"
        title="Settings"
        description="Manage live pricing, privacy preferences and local portfolio backups."
        actions={
          <Button
            disabled={refreshState === 'loading' || !portfolio.holdings.length}
            onClick={() => void refreshPrices()}
            className="h-9 rounded-xl bg-[#d8ff58] text-[10px] text-[#090b0b] hover:bg-[#e4ff83]"
          >
            <RefreshCw
              className={`size-3.5 ${refreshState === 'loading' ? 'animate-spin' : ''}`}
            />{' '}
            Test live prices
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Database}
          label="Saved positions"
          value={String(portfolio.holdings.length)}
          detail={`${analytics.holdings.length} counted · ${analytics.dustCount} dust asset${analytics.dustCount === 1 ? '' : 's'} hidden`}
        />
        <MetricCard
          icon={Radio}
          label="Live price coverage"
          value={`${analytics.resolvedCount}/${analytics.holdings.length}`}
          detail={refreshStateLabel(refreshState)}
          tone={
            analytics.holdings.length > 0 &&
            analytics.resolvedCount === analytics.holdings.length
              ? 'positive'
              : 'default'
          }
        />
        <MetricCard
          icon={Wifi}
          label="Active sources"
          value={String(analytics.providerCount)}
          detail="Automatic fallback pipeline"
          tone="accent"
        />
        <MetricCard
          icon={HardDrive}
          label="Local data size"
          value={storageSize}
          detail="Browser localStorage usage"
        />
      </section>

      <section className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(360px,.72fr)]">
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Preferences"
            description="Behavior that applies across every page"
          />
          <div className="divide-y divide-white/[0.055] px-5">
            <SettingRow
              icon={RefreshCw}
              title="Auto-refresh prices"
              description="Refresh open-position quotes every 60 seconds while Tessera is open."
              control={
                <Switch
                  checked={portfolio.autoRefresh}
                  onCheckedChange={setAutoRefresh}
                  aria-label="Toggle automatic price refresh"
                />
              }
            />
            <SettingRow
              icon={EyeOff}
              title="Privacy mode"
              description="Mask dollar balances and position values without changing calculations."
              control={
                <Switch
                  checked={portfolio.privacyMode}
                  onCheckedChange={setPrivacyMode}
                  aria-label="Toggle privacy mode"
                />
              }
            />
            <SettingRow
              icon={SlidersHorizontal}
              title="Minimum asset value"
              description="Hide combined tickers below this USD exposure from portfolio totals, charts and default position lists."
              control={
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-white/28">
                    $
                  </span>
                  <Input
                    aria-label="Minimum asset value in dollars"
                    type="number"
                    min="0"
                    max="1000000"
                    step="1"
                    value={portfolio.minimumPositionValue}
                    onChange={(event) =>
                      setMinimumPositionValue(Number(event.target.value))
                    }
                    className="h-9 w-24 rounded-xl border-white/[0.08] bg-white/[0.03] pl-7 pr-2 text-right font-mono text-[10px]"
                  />
                </div>
              }
            />
            <SettingRow
              icon={ShieldCheck}
              title="Local-only storage"
              description="No login, database, wallet connection or remote portfolio sync is used."
              control={
                <span className="flex items-center gap-1.5 rounded-full border border-[#d8ff58]/15 bg-[#d8ff58]/[0.05] px-2.5 py-1 text-[7px] font-semibold uppercase tracking-[0.13em] text-[#d8ff58]">
                  <Check className="size-3" /> Active
                </span>
              }
            />
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader
            title="Portable backup"
            description="Move or restore your local portfolio as JSON"
          />
          <div className="p-5">
            <div className="rounded-2xl border border-white/[0.07] bg-black/15 p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.04] text-white/40">
                  <FileJson className="size-[18px]" />
                </div>
                <div>
                  <p className="text-[11px] font-medium">
                    Tessera portfolio file
                  </p>
                  <p className="mt-1 text-[9px] leading-4 text-white/30">
                    Includes positions, import profiles, saved price snapshots
                    and preferences. Live prices are refreshed after import.
                  </p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  onClick={exportPortfolio}
                  variant="outline"
                  className="h-9 rounded-xl border-white/[0.08] bg-white/[0.025] text-[9px] text-white/60 hover:bg-white/[0.06] hover:text-white"
                >
                  <Download className="size-3.5" /> Export JSON
                </Button>
                <Button
                  disabled={importing}
                  onClick={() => fileRef.current?.click()}
                  variant="outline"
                  className="h-9 rounded-xl border-white/[0.08] bg-white/[0.025] text-[9px] text-white/60 hover:bg-white/[0.06] hover:text-white"
                >
                  <FileUp className="size-3.5" />{' '}
                  {importing ? 'Importing…' : 'Import JSON'}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                    event.target.value = '';
                  }}
                />
              </div>
            </div>
            <p className="mt-3 flex items-start gap-2 text-[8px] leading-4 text-white/24">
              <HardDrive className="mt-0.5 size-3 shrink-0" /> Export before
              clearing browser data or switching browser profiles. Shutting down
              the server does not clear the saved portfolio.
            </p>
          </div>
        </Panel>
      </section>

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Market data pipeline"
          description="Free, keyless providers with automatic fallback and cached-price resilience"
          aside={
            <span
              className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-[7px] uppercase tracking-[0.12em] ${refreshState === 'error' ? 'bg-[#ff7777]/10 text-[#ff8585]' : 'bg-[#d8ff58]/[0.07] text-[#d8ff58]'}`}
            >
              <span
                className={`size-1.5 rounded-full ${refreshState === 'error' ? 'bg-[#ff7777]' : 'bg-[#d8ff58]'}`}
              />{' '}
              {refreshStateLabel(refreshState)}
            </span>
          }
        />
        <div className="grid gap-px bg-white/[0.05] sm:grid-cols-2 xl:grid-cols-4">
          {providers.map((provider, index) => (
            <div key={provider.name} className="bg-[#0d100f] p-5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8px] text-white/18">
                  0{index + 1}
                </span>
                <span className="size-1.5 rounded-full bg-[#d8ff58]/70" />
              </div>
              <h3 className="mt-4 text-[11px] font-semibold">
                {provider.name}
              </h3>
              <p className="mt-1 text-[8px] font-medium uppercase tracking-[0.12em] text-[#d8ff58]/55">
                {provider.role}
              </p>
              <p className="mt-3 text-[9px] leading-4 text-white/28">
                {provider.description}
              </p>
            </div>
          ))}
        </div>
        <div className="border-t border-white/[0.055] px-5 py-4">
          <p className="text-[8px] font-medium uppercase tracking-[0.14em] text-white/24">
            Current quote attribution
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {sources.length ? (
              sources.map((source) => (
                <span
                  key={source.provider}
                  className="rounded-lg border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5 text-[8px] text-white/40"
                >
                  {source.provider}{' '}
                  <b className="ml-1 font-mono text-white/70">{source.count}</b>
                </span>
              ))
            ) : (
              <span className="text-[9px] text-white/25">
                Add a position and run a refresh to see live source attribution.
              </span>
            )}
          </div>
        </div>
      </Panel>

      <Panel className="mt-3 overflow-hidden border-[#ff7777]/10">
        <PanelHeader
          title="Portfolio maintenance"
          description="Destructive changes require confirmation"
        />
        <div className="p-5">
          {confirmAction ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-[#ff7777]/18 bg-[#ff7777]/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#ff7777]/10 text-[#ff8585]">
                  <Trash2 className="size-4" />
                </div>
                <div>
                  <p className="text-[11px] font-medium">
                    {confirmAction === 'clear'
                      ? 'Clear manual portfolio data?'
                      : 'Restore the sample portfolio?'}
                  </p>
                  <p className="mt-1 text-[9px] leading-4 text-white/30">
                    {confirmAction === 'clear'
                      ? 'Manual positions and saved chart history will be removed. Saved import profiles and their linked positions remain.'
                      : 'The demo positions will be restored alongside your saved import profiles and their linked positions.'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmAction(null)}
                  className="text-[9px] text-white/40"
                >
                  <X className="size-3" /> Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={runConfirmedAction}
                  className="text-[9px]"
                >
                  <Check className="size-3" /> Confirm
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-[9px] leading-4 text-white/28">
                Restore the demo or clear manual holdings without touching saved
                import profiles. Remove a profile from Position import when you
                want its linked positions deleted.
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  onClick={() => setConfirmAction('sample')}
                  variant="outline"
                  className="h-9 rounded-xl border-white/[0.08] bg-white/[0.02] text-[9px] text-white/48 hover:bg-white/[0.06] hover:text-white"
                >
                  <RotateCcw className="size-3.5" /> Restore sample
                </Button>
                <Button
                  onClick={() => setConfirmAction('clear')}
                  variant="outline"
                  className="h-9 rounded-xl border-[#ff7777]/15 bg-[#ff7777]/[0.025] text-[9px] text-[#ff8585] hover:bg-[#ff7777]/10 hover:text-[#ffa0a0]"
                >
                  <Trash2 className="size-3.5" /> Clear manual data
                </Button>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </>
  );
}

function SettingRow({
  icon: Icon,
  title,
  description,
  control,
}: {
  icon: typeof RefreshCw;
  title: string;
  description: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-4">
      <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.035] text-white/38">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium text-white/75">{title}</p>
        <p className="mt-1 text-[8px] leading-4 text-white/28">{description}</p>
      </div>
      {control}
    </div>
  );
}

function refreshStateLabel(
  state: 'idle' | 'loading' | 'success' | 'warning' | 'error',
) {
  if (state === 'loading') return 'Testing providers';
  if (state === 'success') return 'Prices live';
  if (state === 'warning') return 'Partial coverage';
  if (state === 'error') return 'Using cached prices';
  return 'Ready to sync';
}
