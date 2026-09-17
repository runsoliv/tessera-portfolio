'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  CirclePlus,
  Gauge,
  Pencil,
  Plus,
  Search,
  Trash2,
  WalletCards,
} from 'lucide-react';

import { usePortfolio } from '@/components/portfolio-provider';
import {
  AssetIdentity,
  EmptyState,
  MetricCard,
  PageIntro,
  Panel,
} from '@/components/page-primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMoney, formatNumber } from '@/lib/portfolio';
import { importProfileIdsForHolding } from '@/lib/import-profiles';

type Filter = 'all' | 'spot' | 'stock' | 'staked' | 'perp';
type Sort = 'exposure' | 'equity' | 'change' | 'name';

export default function PositionsPage() {
  const {
    portfolio,
    analytics,
    importProfiles,
    openAdd,
    openEdit,
    openAdjust,
    requestDelete,
  } = usePortfolio();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('exposure');
  const [query, setQuery] = useState('');
  const [showDust, setShowDust] = useState(false);
  const privacy = portfolio.privacyMode;
  const percentOfPortfolio = (value: number) =>
    analytics.totalValue ? (value / analytics.totalValue) * 100 : 0;
  const profileNames = useMemo(
    () => new Map(importProfiles.map((profile) => [profile.id, profile.name])),
    [importProfiles],
  );

  const positions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const source = showDust
      ? [...analytics.holdings, ...analytics.dustHoldings]
      : analytics.holdings;
    const filtered = source.filter((holding) => {
      const holdingProfileNames = importProfileIdsForHolding(holding)
        .map((profileId) => profileNames.get(profileId) ?? '')
        .join(' ');
      const matchesType =
        filter === 'all' ||
        (filter === 'perp' && holding.positionKind === 'perp') ||
        (filter === 'stock' &&
          holding.positionKind === 'spot' &&
          holding.instrumentType === 'stock') ||
        (filter === 'spot' &&
          holding.positionKind === 'spot' &&
          holding.instrumentType !== 'stock' &&
          (!holding.assetClass || holding.assetClass === 'spot')) ||
        (filter === 'staked' &&
          holding.positionKind === 'spot' &&
          holding.instrumentType !== 'stock' &&
          holding.assetClass != null &&
          holding.assetClass !== 'spot');
      const matchesQuery =
        !normalized ||
        `${holding.name} ${holding.symbol} ${holding.platform ?? ''} ${holding.network ?? ''} ${holding.provider ?? ''} ${holdingProfileNames}`
          .toLowerCase()
          .includes(normalized);
      return matchesType && matchesQuery;
    });
    return filtered.sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'change'
          ? Number(b.change24h ?? -Infinity) - Number(a.change24h ?? -Infinity)
          : sort === 'equity'
            ? b.value - a.value
            : b.exposureValue - a.exposureValue,
    );
  }, [
    analytics.dustHoldings,
    analytics.holdings,
    filter,
    query,
    profileNames,
    showDust,
    sort,
  ]);

  return (
    <>
      <PageIntro
        eyebrow="Portfolio"
        title="Positions"
        description="Review and manage crypto, stocks and perpetual contracts with position-specific valuation and risk metrics."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => openAdd('perp')}
              className="h-9 rounded-xl border-white/[0.08] bg-white/[0.02] text-[10px] text-white/55 hover:bg-white/[0.06] hover:text-white"
            >
              <Gauge className="size-3.5" /> Enter perp
            </Button>
            <Button
              onClick={() => openAdd('spot')}
              className="h-9 rounded-xl bg-[#c8ff5a] text-[10px] font-semibold text-[#080b0e] hover:bg-[#d7ff7e]"
            >
              <Plus className="size-3.5" /> Add asset
            </Button>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          icon={WalletCards}
          label="Crypto holdings"
          value={`${analytics.cryptoSpot.length}`}
          detail={
            privacy
              ? `${analytics.staked.length} staking balances`
              : `${formatMoney(analytics.cryptoSpotValue)} · ${percentOfPortfolio(analytics.cryptoSpotValue).toFixed(1)}% of portfolio`
          }
        />
        <MetricCard
          icon={ChartNoAxesCombined}
          label="Stock holdings"
          value={`${analytics.stocks.length}`}
          detail={
            privacy
              ? 'Equity hidden'
              : `${formatMoney(analytics.stockValue)} · ${percentOfPortfolio(analytics.stockValue).toFixed(1)}% of portfolio`
          }
        />
        <MetricCard
          icon={Gauge}
          label="Perpetuals"
          value={`${analytics.perps.length}`}
          detail={
            privacy
              ? 'Exposure hidden'
              : `${formatMoney(analytics.perpNotional)} · ${analytics.grossExposure ? ((analytics.perpNotional / analytics.grossExposure) * 100).toFixed(1) : '0.0'}% of exposure`
          }
        />
        <MetricCard
          icon={Activity}
          label="Combined equity"
          value={privacy ? '••••' : formatMoney(analytics.totalValue)}
          detail={`${analytics.resolvedCount}/${analytics.holdings.length} live prices`}
          tone="accent"
        />
        <MetricCard
          icon={analytics.dayPnl >= 0 ? ArrowUpRight : ArrowDownRight}
          label="Daily impact"
          value={
            privacy
              ? '••••'
              : `${analytics.dayPnl >= 0 ? '+' : ''}${formatMoney(analytics.dayPnl)}`
          }
          detail={`${analytics.dayChange >= 0 ? '+' : ''}${analytics.dayChange.toFixed(2)}% weighted move`}
          tone={analytics.dayPnl >= 0 ? 'positive' : 'negative'}
        />
      </section>

      <Panel className="mt-3 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-white/[0.06] px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-1 rounded-xl border border-white/[0.08] bg-black/15 p-1">
            {(['all', 'spot', 'stock', 'staked', 'perp'] as Filter[]).map(
              (item) => (
                <button
                  key={item}
                  onClick={() => setFilter(item)}
                  className={`rounded-lg px-3 py-2 text-[11px] font-medium capitalize transition ${filter === item ? 'bg-[#c8ff5a]/10 text-[#d5ff78] shadow-[inset_0_0_0_1px_rgba(200,255,90,.12)]' : 'text-white/48 hover:bg-white/[0.035] hover:text-white/75'}`}
                >
                  {item === 'perp'
                    ? 'Perpetuals'
                    : item === 'spot'
                      ? 'Crypto spot'
                      : item === 'stock'
                        ? 'Stocks'
                        : item}
                </button>
              ),
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {analytics.dustCount > 0 && (
              <button
                onClick={() => setShowDust((value) => !value)}
                className={`h-10 rounded-xl border px-3 text-[11px] transition ${showDust ? 'border-[#c8ff5a]/20 bg-[#c8ff5a]/[0.06] text-[#c8ff5a]' : 'border-white/[0.08] bg-white/[0.02] text-white/48 hover:text-white/70'}`}
              >
                {showDust ? 'Hide' : 'Show'} dust ({analytics.dustCount})
              </button>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/22" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search asset, platform or source"
                className="h-10 w-full rounded-xl border-white/[0.1] bg-white/[0.03] pl-9 text-[12px] sm:w-64"
              />
            </div>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              aria-label="Sort positions"
              className="h-10 rounded-xl border border-white/[0.1] bg-[#11171a] px-3 text-[11px] text-white/65 outline-none focus:border-[#c8ff5a]/50"
            >
              <option value="exposure">Sort: exposure</option>
              <option value="equity">Sort: equity</option>
              <option value="change">Sort: 24h change</option>
              <option value="name">Sort: name</option>
            </select>
          </div>
        </div>

        {positions.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left">
              <thead className="border-b border-white/[0.075] bg-white/[0.012] text-[10px] uppercase tracking-[0.11em] text-white/45">
                <tr>
                  <th className="px-5 py-3 font-medium">Position</th>
                  <th className="px-3 py-3 font-medium">Quantity / notional</th>
                  <th className="px-3 py-3 text-right font-medium">
                    Market / entry
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    Value / portfolio
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    All-time / 24h
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    Target plan
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    Exposure / share
                  </th>
                  <th aria-label="Actions" className="w-28 px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {positions.map((holding) => {
                  const perp = holding.positionKind === 'perp';
                  const allTimePnl = perp
                    ? holding.unrealizedPnl
                    : (holding.stakingRewardsValue ?? holding.unrealizedPnl);
                  const allTimeLabel = perp
                    ? 'Live unrealized P&L'
                    : holding.stakingRewardsValue != null
                      ? `All-time staking rewards · ${formatNumber(Number(holding.stakingRewardsAmount ?? 0))} ${holding.symbol}`
                      : holding.unrealizedPnl != null
                        ? 'All-time cost-basis P&L'
                        : 'All-time unavailable';
                  const linkedProfiles = importProfileIdsForHolding(holding)
                    .map((profileId) => profileNames.get(profileId))
                    .filter(Boolean);
                  const importLabel = linkedProfiles.length
                    ? linkedProfiles.length === 1
                      ? linkedProfiles[0]
                      : `${linkedProfiles.length} saved imports`
                    : null;
                  return (
                    <tr
                      key={holding.id}
                      className="border-b border-white/[0.055] last:border-0 hover:bg-white/[0.025]"
                    >
                      <td
                        aria-label={`${holding.name} position`}
                        className="px-5 py-4"
                      >
                        <AssetIdentity holding={holding} />
                      </td>
                      <td className="px-3 py-4">
                        <p className="font-mono text-[11px] font-medium text-white/75">
                          {privacy ? '••••' : formatNumber(holding.amount)}{' '}
                          {holding.instrumentType === 'stock'
                            ? 'shares'
                            : holding.symbol}
                        </p>
                        <p className="mt-1.5 text-[10px] text-white/45">
                          {perp
                            ? `${privacy ? 'Hidden' : formatMoney(holding.notional, true)} notional${importLabel ? ` · ${importLabel}` : ''}`
                            : importLabel
                              ? importLabel
                              : holding.instrumentType === 'stock'
                                ? `${holding.symbol} shares`
                                : holding.importedFrom
                                  ? `${holding.importedFrom === 'onchain' ? 'Onchain' : holding.importedFrom === 'hyperliquid' ? 'Hyperliquid' : holding.importedFrom === 'screenshot' ? 'Screenshot' : 'Lighter'} snapshot`
                                  : holding.source === 'dexscreener'
                                    ? 'Onchain token'
                                    : 'Owned spot'}
                        </p>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <p className="font-mono text-[11px] font-medium text-white/75">
                          {privacy
                            ? '••••'
                            : formatMoney(
                                Number(
                                  holding.price ?? holding.manualPrice ?? 0,
                                ),
                              )}
                        </p>
                        <p className="mt-1.5 text-[10px] text-white/45">
                          {perp
                            ? `Entry ${privacy ? '••••' : formatMoney(Number(holding.entryPrice))}`
                            : (holding.provider ?? 'Awaiting quote')}
                        </p>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <p className="font-mono text-[12px] font-semibold text-white/92">
                          {privacy ? '••••' : formatMoney(holding.value)}
                        </p>
                        <div className="mt-1.5 flex items-center justify-end gap-2">
                          <span className="rounded-lg border border-[#c8ff5a]/25 bg-[#c8ff5a]/[0.1] px-2 py-1 font-mono text-[15px] font-bold text-[#ddff82]">
                            {holding.allocation.toFixed(1)}%
                          </span>
                          <span className="text-[9px] text-white/42">
                            {perp
                              ? `${holding.marginMode} · ${holding.leverage}×`
                              : 'of portfolio'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <p
                          className={`font-mono text-[12px] font-semibold ${allTimePnl == null ? 'text-white/45' : allTimePnl >= 0 ? 'text-[#63e6ab]' : 'text-[#ff7d8f]'}`}
                        >
                          {allTimePnl == null
                            ? '—'
                            : privacy
                              ? '••••'
                              : `${allTimePnl >= 0 ? '+' : ''}${formatMoney(allTimePnl, true)}`}
                        </p>
                        <p className="mt-1.5 text-[10px] text-white/45">
                          {allTimeLabel}
                          {perp && holding.roe != null
                            ? ` · ${Number(holding.roe).toFixed(1)}% ROE`
                            : ''}
                        </p>
                        <p className="mt-1 text-[10px] text-white/45">
                          {holding.change24h == null
                            ? '24h unavailable'
                            : privacy
                              ? '24h ••••'
                              : `24h ${holding.dayPnl >= 0 ? '+' : ''}${formatMoney(holding.dayPnl, true)} · ${Number(holding.change24h) >= 0 ? '+' : ''}${Number(holding.change24h).toFixed(2)}%`}
                        </p>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <p className="font-mono text-[11px] font-medium text-white/75">
                          {holding.targetPrice
                            ? privacy
                              ? '••••'
                              : formatMoney(holding.targetPrice)
                            : '—'}
                        </p>
                        <p className="mt-1.5 text-[10px] text-white/45">
                          {perp
                            ? `SL ${holding.stopLossPrice ? (privacy ? '••••' : formatMoney(holding.stopLossPrice)) : 'not set'}`
                            : holding.targetPrice
                              ? `${holding.targetDelta >= 0 ? '+' : ''}${privacy ? 'hidden' : formatMoney(holding.targetDelta, true)}`
                              : 'No target'}
                        </p>
                      </td>
                      <td
                        aria-label={`${holding.exposureAllocation.toFixed(1)} percent of gross exposure`}
                        className="px-3 py-4 text-right"
                      >
                        <p className="font-mono text-[11px] font-medium text-white/80">
                          {privacy
                            ? '••••'
                            : formatMoney(holding.exposureValue, true)}
                        </p>
                        <p className="mt-1 font-mono text-[16px] font-bold text-[#9db9ff]">
                          {holding.exposureAllocation.toFixed(1)}%
                        </p>
                        <div className="ml-auto mt-2 h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.065]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(0, Math.min(100, holding.exposureAllocation))}%`,
                              background: holding.color,
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => openAdjust(holding)}
                            aria-label={`Adjust ${holding.name} quantity`}
                            title="Adjust quantity"
                            className="grid size-8 place-items-center rounded-lg text-[#c8ff5a]/60 hover:bg-[#c8ff5a]/10 hover:text-[#c8ff5a]"
                          >
                            <CirclePlus className="size-3.5" />
                          </button>
                          <button
                            onClick={() => openEdit(holding)}
                            aria-label={`Edit ${holding.name}`}
                            title="Edit position"
                            className="grid size-8 place-items-center rounded-lg text-white/42 hover:bg-white/[0.055] hover:text-white"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            onClick={() => requestDelete(holding)}
                            aria-label={`Remove ${holding.name}`}
                            title="Remove position"
                            className="grid size-8 place-items-center rounded-lg text-white/38 hover:bg-[#ff7d8f]/10 hover:text-[#ff7d8f]"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={WalletCards}
            title={
              portfolio.holdings.length
                ? analytics.holdings.length
                  ? 'No matching positions'
                  : 'All saved positions are below the cutoff'
                : 'Your ledger is empty'
            }
            description={
              portfolio.holdings.length
                ? analytics.holdings.length
                  ? 'Adjust the filters or search query.'
                  : `Show dust or lower the $${analytics.minimumPositionValue.toLocaleString()} minimum in Settings.`
                : 'Add a spot holding or perpetual contract to begin.'
            }
            action={
              !portfolio.holdings.length ? (
                <Button
                  onClick={() => openAdd('spot')}
                  className="bg-[#d8ff58] text-[#090b0b] hover:bg-[#e4ff83]"
                >
                  <Plus className="size-3.5" /> Add first position
                </Button>
              ) : undefined
            }
          />
        )}
      </Panel>
    </>
  );
}
