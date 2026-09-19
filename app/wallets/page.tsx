'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Check,
  DatabaseZap,
  Gauge,
  ImageUp,
  Layers3,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Wallet,
  Waypoints,
  Zap,
} from 'lucide-react';

import {
  MetricCard,
  PageIntro,
  Panel,
  PanelHeader,
} from '@/components/page-primitives';
import { usePortfolio } from '@/components/portfolio-provider';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { calculateAnalytics, relativeTime } from '@/lib/analytics';
import { holdingsForImportProfile } from '@/lib/import-profiles';
import { formatMoney, formatNumber, type ImportProfile } from '@/lib/portfolio';
import type {
  WalletImportCandidate,
  WalletImportResponse,
  WalletImportSource,
} from '@/lib/wallet-import';

const sources = [
  {
    id: 'onchain' as const,
    label: 'Onchain wallet',
    detail: 'EVM, Solana and native token balances',
    icon: Waypoints,
  },
  {
    id: 'hyperliquid' as const,
    label: 'Hyperliquid',
    detail: 'Spot, staked HYPE and perpetuals',
    icon: Zap,
  },
  {
    id: 'lighter' as const,
    label: 'Lighter / Robinhood Lighter',
    detail: 'Automatically finds either venue by wallet address',
    icon: Layers3,
  },
];

const networks = [
  { id: 'solana', label: 'Solana' },
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'base', label: 'Base' },
  { id: 'arbitrum', label: 'Arbitrum' },
  { id: 'optimism', label: 'Optimism' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'gnosis', label: 'Gnosis' },
  { id: 'celo', label: 'Celo' },
  { id: 'robinhood', label: 'Robinhood Chain' },
];

export default function WalletsPage() {
  const router = useRouter();
  const {
    portfolio,
    importProfiles,
    mergeWalletPositions,
    openScreenshotImport,
    renameImportProfile,
    removeImportProfile,
    syncImportProfile,
  } = usePortfolio();
  const [source, setSource] = useState<WalletImportSource>('onchain');
  const [network, setNetwork] = useState('ethereum');
  const [address, setAddress] = useState('');
  const [result, setResult] = useState<WalletImportResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [removingProfileId, setRemovingProfileId] = useState<string | null>(
    null,
  );
  const [syncingProfileId, setSyncingProfileId] = useState<string | null>(null);

  const profileSummaries = useMemo(
    () =>
      importProfiles
        .map((profile) => {
          const holdings = holdingsForImportProfile(
            portfolio.holdings,
            profile.id,
          );
          const summary = calculateAnalytics(holdings, 0);
          return {
            ...profile,
            positionCount: holdings.length,
            equity: summary.totalValue,
            exposure: summary.grossExposure,
          };
        })
        .sort((a, b) => b.lastImportedAt - a.lastImportedAt),
    [importProfiles, portfolio.holdings],
  );

  const selectedItems = useMemo(
    () => result?.items.filter((item) => selected.has(item.id)) ?? [],
    [result, selected],
  );
  const liquidCount =
    result?.items.filter(
      (item) =>
        item.positionType === 'spot' &&
        (!item.assetClass || item.assetClass === 'spot'),
    ).length ?? 0;
  const stakedCount =
    result?.items.filter(
      (item) =>
        item.positionType === 'spot' &&
        item.assetClass &&
        item.assetClass !== 'spot',
    ).length ?? 0;
  const perpCount =
    result?.items.filter((item) => item.positionType === 'perp').length ?? 0;
  const selectedValue = selectedItems.reduce(
    (sum, item) => sum + Number(item.estimatedValue ?? 0),
    0,
  );

  function chooseSource(next: WalletImportSource) {
    setSource(next);
    setResult(null);
    setSelected(new Set());
    setError('');
  }

  async function scanWallet(event: { preventDefault: () => void }) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/wallet/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          address: address.trim(),
          network: source === 'onchain' ? network : undefined,
        }),
      });
      const data = (await response.json()) as WalletImportResponse & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error || 'Wallet data could not be loaded.');
      setResult(data);
      const recommended = data.items
        .filter(
          (item) =>
            item.positionType === 'perp' ||
            item.estimatedValue != null ||
            item.coinId,
        )
        .map((item) => item.id);
      setSelected(
        new Set(
          recommended.length ? recommended : data.items.map((item) => item.id),
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Wallet data could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function importSelected() {
    if (!result || !selectedItems.length) return;
    mergeWalletPositions(
      selectedItems,
      result.source,
      result.address,
      result.warnings,
    );
    router.push('/positions');
  }

  return (
    <>
      <PageIntro
        eyebrow="Portfolio entry"
        title="Position import"
        description="Copy balances from a wallet address or read positions from screenshots. Imports are one-time snapshots and remain locally editable."
        actions={
          <Button
            onClick={() => openScreenshotImport()}
            className="h-9 rounded-xl bg-primary text-[10px] text-primary-foreground hover:bg-primary/90"
          >
            <ImageUp className="size-3.5" /> Import screenshots
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          icon={Wallet}
          label="Saved profiles"
          value={String(importProfiles.length)}
          detail="Persistent until you remove them"
          tone="accent"
        />
        <MetricCard
          icon={DatabaseZap}
          label="Import behavior"
          value="Live venue sync"
          detail="Lighter, Robinhood Lighter and Hyperliquid positions update automatically"
        />
        <MetricCard
          icon={ShieldCheck}
          label="Credentials"
          value="Not required"
          detail="Public read-only endpoints"
        />
      </section>

      <Panel className="mt-3 overflow-hidden">
        <PanelHeader
          title="Saved import profiles"
          description="Every wallet or screenshot batch owns its positions and survives portfolio resets"
          aside={
            importProfiles.length ? (
              <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 font-mono text-[10px] text-primary">
                {importProfiles.length} active
              </span>
            ) : undefined
          }
        />
        {profileSummaries.length ? (
          <div className="grid gap-px bg-border md:grid-cols-2 xl:grid-cols-3">
            {profileSummaries.map((profile) => (
              <ImportProfileCard
                key={profile.id}
                profile={profile}
                privacy={portfolio.privacyMode}
                editing={editingProfileId === profile.id}
                removing={removingProfileId === profile.id}
                syncing={syncingProfileId === profile.id}
                draftName={profileName}
                onDraftNameChange={setProfileName}
                onStartEdit={() => {
                  setEditingProfileId(profile.id);
                  setProfileName(profile.name);
                  setRemovingProfileId(null);
                }}
                onCancelEdit={() => setEditingProfileId(null)}
                onSaveEdit={() => {
                  renameImportProfile(profile.id, profileName);
                  setEditingProfileId(null);
                }}
                onSync={async () => {
                  setSyncingProfileId(profile.id);
                  await syncImportProfile(profile.id);
                  setSyncingProfileId(null);
                }}
                onStartRemove={() => {
                  setRemovingProfileId(profile.id);
                  setEditingProfileId(null);
                }}
                onCancelRemove={() => setRemovingProfileId(null)}
                onConfirmRemove={() => {
                  removeImportProfile(profile.id);
                  setRemovingProfileId(null);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="px-5 py-8 text-center">
            <Wallet className="mx-auto size-5 text-muted-foreground/50" />
            <p className="mt-3 text-[11px] font-medium text-foreground">
              No saved import profiles yet
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Your first wallet or screenshot import will create one here.
            </p>
          </div>
        )}
      </Panel>

      <section className="mt-3 grid gap-3 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Panel className="overflow-hidden self-start">
          <PanelHeader
            title="Source and address"
            description="Select where the positions are currently held"
          />
          <form onSubmit={scanWallet} className="p-5">
            <div className="space-y-2">
              {sources.map((item) => {
                const Icon = item.icon;
                const active = source === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => chooseSource(item.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${active ? 'border-primary/30 bg-primary/10' : 'border-border bg-card hover:bg-muted'}`}
                  >
                    <span
                      className={`grid size-9 shrink-0 place-items-center rounded-xl ${active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block text-[11px] font-medium ${active ? 'text-foreground' : 'text-muted-foreground'}`}
                      >
                        {item.label}
                      </span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        {item.detail}
                      </span>
                    </span>
                    {active && <Check className="size-3.5 text-primary" />}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => openScreenshotImport('Variational')}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left transition hover:border-primary/30 hover:bg-muted"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                  <ImageUp className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-medium text-foreground">
                    Variational
                  </span>
                  <span className="mt-1 block text-[10px] text-muted-foreground">
                    Import a positions screenshot · no address-only sync
                  </span>
                </span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </button>
            </div>

            {source === 'onchain' && (
              <label className="mt-5 block">
                <span className="mb-2 block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Network
                </span>
                <select
                  value={network}
                  onChange={(event) => {
                    setNetwork(event.target.value);
                    setResult(null);
                  }}
                  className="h-11 w-full rounded-xl border border-input bg-card px-3 text-[11px] text-foreground outline-none focus:border-ring"
                >
                  {networks.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="mt-4 block">
              <span className="mb-2 block text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {source === 'lighter'
                  ? 'L1 wallet address'
                  : source === 'onchain' && network === 'solana'
                    ? 'Solana wallet address'
                    : 'Wallet address'}
              </span>
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder={
                  source === 'onchain' && network === 'solana'
                    ? 'Base58 Solana address'
                    : '0x…'
                }
                spellCheck={false}
                className="form-input font-mono text-[10px]"
              />
            </label>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
              The address is sent only to the selected public data provider
              during this scan. It is not monitored afterward.
            </p>
            {error && (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-[10px] leading-4 text-destructive"
              >
                {error}
              </p>
            )}
            <Button
              disabled={loading || !address.trim()}
              type="submit"
              className="mt-5 h-10 w-full rounded-xl bg-primary text-[11px] text-primary-foreground hover:bg-primary/90"
            >
              <RefreshCw
                className={`size-3.5 ${loading ? 'animate-spin' : ''}`}
              />{' '}
              {loading ? 'Reading wallet…' : 'Read wallet'}
            </Button>
          </form>
        </Panel>

        <Panel className="min-h-[460px] overflow-hidden">
          <PanelHeader
            title="Import review"
            description={
              result?.network
                ? `${result.network} · select the balances and positions to add`
                : 'Select the balances and positions to add to the portfolio'
            }
            aside={
              result?.items.length ? (
                <div className="flex gap-1">
                  <button
                    onClick={() =>
                      setSelected(new Set(result.items.map((item) => item.id)))
                    }
                    className="rounded-lg px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setSelected(new Set())}
                    className="rounded-lg px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              ) : undefined
            }
          />
          {!result ? (
            <InitialState loading={loading} />
          ) : result.items.length ? (
            <>
              <div className="grid grid-cols-3 gap-px border-b border-border bg-border">
                <ReviewMetric
                  label="Found"
                  value={`${result.items.length}`}
                  detail="positions"
                />
                <ReviewMetric
                  label="Liquid / staked / perps"
                  value={`${liquidCount} / ${stakedCount} / ${perpCount}`}
                  detail="by position type"
                />
                <ReviewMetric
                  label="Selected value"
                  value={
                    selectedValue
                      ? formatMoney(selectedValue, true)
                      : 'Unpriced'
                  }
                  detail="known estimates"
                />
              </div>
              {result.warnings.length > 0 && (
                <div className="border-b border-amber-500/20 bg-amber-500/10 px-5 py-3">
                  {result.warnings.map((warning) => (
                    <p
                      key={warning}
                      className="text-[10px] leading-4 text-amber-700 dark:text-amber-300"
                    >
                      {warning}
                    </p>
                  ))}
                </div>
              )}
              <div className="max-h-[430px] divide-y divide-border overflow-y-auto">
                {result.items.map((item) => (
                  <ImportRow
                    key={item.id}
                    item={item}
                    checked={selected.has(item.id)}
                    onCheckedChange={(checked) => toggle(item.id, checked)}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-3 border-t border-border bg-muted/40 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[10px] leading-4 text-muted-foreground">
                  Re-importing this same wallet adds to its saved profile. Other
                  profiles and manual positions stay separate.
                </p>
                <Button
                  disabled={!selectedItems.length}
                  onClick={importSelected}
                  className="h-9 shrink-0 rounded-xl bg-primary text-[10px] text-primary-foreground hover:bg-primary/90"
                >
                  Add {selectedItems.length} selected{' '}
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </>
          ) : (
            <div className="grid min-h-[390px] place-items-center px-6 text-center">
              <div>
                <Wallet className="mx-auto size-6 text-muted-foreground/50" />
                <p className="mt-4 text-[11px] font-medium">
                  No active balances found
                </p>
                <p className="mt-2 max-w-xs text-[10px] leading-4 text-muted-foreground">
                  The provider returned no positive balances or open positions
                  for this address and source.
                </p>
              </div>
            </div>
          )}
        </Panel>
      </section>

      <div className="mt-3 flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <Gauge className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <p className="text-[10px] leading-4 text-muted-foreground">
          After import, use the adjustment control in the Positions ledger to
          increase or decrease quantity manually. Spot cost basis and perpetual
          entry price are recalculated when an execution price is supplied.
        </p>
      </div>
    </>
  );
}

type ImportProfileSummary = ImportProfile & {
  positionCount: number;
  equity: number;
  exposure: number;
};

function ImportProfileCard({
  profile,
  privacy,
  editing,
  removing,
  syncing,
  draftName,
  onDraftNameChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onSync,
  onStartRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  profile: ImportProfileSummary;
  privacy: boolean;
  editing: boolean;
  removing: boolean;
  syncing: boolean;
  draftName: string;
  onDraftNameChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onSync: () => Promise<void>;
  onStartRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  const Icon =
    profile.source === 'screenshot'
      ? ImageUp
      : profile.source === 'hyperliquid'
        ? Zap
        : profile.source === 'lighter'
          ? Layers3
          : Waypoints;
  const sourceLabel =
    profile.source === 'screenshot'
      ? 'Screenshot batch'
      : profile.source === 'hyperliquid'
        ? 'Hyperliquid wallet'
        : profile.source === 'lighter'
          ? 'Lighter wallet'
          : 'Onchain wallet';
  const location = [profile.platform, profile.network]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(' · ');

  return (
    <article className="bg-card p-5 text-card-foreground">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex gap-1.5">
              <Input
                value={draftName}
                maxLength={80}
                onChange={(event) => onDraftNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSaveEdit();
                  if (event.key === 'Escape') onCancelEdit();
                }}
                aria-label="Import profile name"
                className="h-8 rounded-lg border-input bg-background text-[10px] text-foreground"
              />
              <Button
                size="sm"
                disabled={!draftName.trim()}
                onClick={onSaveEdit}
                className="h-8 rounded-lg bg-primary px-2.5 text-[10px] text-primary-foreground hover:bg-primary/90"
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancelEdit}
                className="h-8 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-[12px] font-semibold text-foreground">
                  {profile.name}
                </h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {sourceLabel} · {relativeTime(profile.lastImportedAt)}
                </p>
              </div>
              <div className="flex shrink-0">
                {(profile.source === 'hyperliquid' ||
                  profile.source === 'lighter') && (
                  <button
                    type="button"
                    onClick={() => void onSync()}
                    disabled={syncing}
                    aria-label={`Sync ${profile.name}`}
                    title="Sync wallet snapshot"
                    className="grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`size-3 ${syncing ? 'animate-spin' : ''}`}
                    />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onStartEdit}
                  aria-label={`Rename ${profile.name}`}
                  className="grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="size-3" />
                </button>
                <button
                  type="button"
                  onClick={onStartRemove}
                  aria-label={`Remove ${profile.name}`}
                  className="grid size-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-muted/50 px-3 py-2.5">
        <p className="truncate text-[10px] text-muted-foreground">{location}</p>
        {profile.address && (
          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
            {shortAddress(profile.address)}
          </p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <ProfileStat label="Positions" value={String(profile.positionCount)} />
        <ProfileStat
          label="Equity"
          value={privacy ? '••••' : formatMoney(profile.equity, true)}
        />
        <ProfileStat
          label="Exposure"
          value={privacy ? '••••' : formatMoney(profile.exposure, true)}
        />
      </div>

      {removing && (
        <div className="mt-4 rounded-xl border border-destructive/25 bg-destructive/10 p-3">
          <p className="text-[10px] font-medium text-destructive">
            Remove profile and {profile.positionCount} linked position
            {profile.positionCount === 1 ? '' : 's'}?
          </p>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
            This is the only action that deletes this imported batch.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={onConfirmRemove}
              className="h-8 text-[8px]"
            >
              <Trash2 className="size-3" /> Remove profile + positions
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancelRemove}
              className="h-8 text-[10px] text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-mono text-[11px] font-medium text-foreground">
        {value}
      </p>
    </div>
  );
}

function shortAddress(address: string) {
  return address.length > 22
    ? `${address.slice(0, 10)}…${address.slice(-8)}`
    : address;
}

function ImportRow({
  item,
  checked,
  onCheckedChange,
}: {
  item: WalletImportCandidate;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const perp = item.positionType === 'perp';
  const positionLabel = perp
    ? `${item.side} ${item.leverage?.toFixed(1)}×`
    : item.assetClass === 'staked'
      ? 'staked'
      : item.assetClass === 'unstaking'
        ? 'unlocking'
        : item.assetClass === 'staking'
          ? 'staking'
          : 'spot';
  const checkboxId = `wallet-import-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  return (
    <label
      htmlFor={checkboxId}
      className="grid cursor-pointer gap-3 px-5 py-3.5 transition hover:bg-muted/50 sm:grid-cols-[20px_minmax(160px,1fr)_110px_110px] sm:items-center"
    >
      <Checkbox
        id={checkboxId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={`Select ${item.name}`}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-[11px] font-medium text-foreground">
            {item.name}
          </p>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${perp ? (item.side === 'short' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary') : item.assetClass && item.assetClass !== 'spot' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'}`}
          >
            {positionLabel}
          </span>
        </div>
        <p className="mt-1 truncate text-[10px] text-muted-foreground">
          {item.platform} · {item.network} · {item.provider}
        </p>
      </div>
      <div>
        <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          Quantity
        </p>
        <p className="mt-1 font-mono text-[10px] text-foreground">
          {formatNumber(item.amount)} {item.symbol}
        </p>
      </div>
      <div className="sm:text-right">
        <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
          {perp ? 'Equity allocation' : 'Value estimate'}
        </p>
        <p className="mt-1 font-mono text-[10px] text-foreground">
          {item.estimatedValue != null
            ? formatMoney(item.estimatedValue, true)
            : item.price
              ? formatMoney(item.amount * item.price, true)
              : 'Unpriced'}
        </p>
      </div>
    </label>
  );
}

function InitialState({ loading }: { loading: boolean }) {
  return (
    <div className="grid min-h-[390px] place-items-center px-6 text-center">
      <div className="max-w-sm">
        <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-border bg-muted text-muted-foreground">
          {loading ? (
            <RefreshCw className="size-5 animate-spin text-primary" />
          ) : (
            <Wallet className="size-5" />
          )}
        </div>
        <p className="mt-4 text-[11px] font-medium">
          {loading ? 'Reading public account data' : 'Enter a wallet address'}
        </p>
        <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
          {loading
            ? 'This can take a few seconds when several account or market endpoints are combined.'
            : 'Results appear here for review before anything is added to the local portfolio.'}
        </p>
      </div>
    </div>
  );
}

function ReviewMetric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="bg-card p-3">
      <p className="text-[9px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-[12px] font-medium text-foreground">
        {value}
      </p>
      <p className="mt-1 text-[9px] text-muted-foreground">{detail}</p>
    </div>
  );
}
