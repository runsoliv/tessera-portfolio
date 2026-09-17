'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  ChartNoAxesCombined,
  Coins,
  Database,
  Search,
  TrendingUp,
  WalletCards,
  Waypoints,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  COLORS,
  CURATED_ASSETS,
  NETWORKS,
  PLATFORMS,
  inferPlatform,
  type AssetClass,
  type AssetOption,
  type Holding,
} from '@/lib/portfolio';

type EntryPriceSource = 'coingecko' | 'dexscreener' | 'yahoo' | 'manual';

type AddAssetDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (holding: Holding) => void;
  existing?: Holding | null;
  colorIndex: number;
  defaultPositionType?: 'spot' | 'perp';
};

export function AddAssetDialog({
  open,
  onOpenChange,
  onSave,
  existing,
  colorIndex,
  defaultPositionType = 'spot',
}: AddAssetDialogProps) {
  const [mode, setMode] = useState<EntryPriceSource>('coingecko');
  const [positionType, setPositionType] = useState<'spot' | 'perp'>('spot');
  const [assetClass, setAssetClass] = useState<AssetClass>('spot');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AssetOption[]>(
    CURATED_ASSETS.slice(0, 10),
  );
  const [selected, setSelected] = useState<AssetOption | null>(null);
  const [amount, setAmount] = useState('');
  const [costBasis, setCostBasis] = useState('');
  const [network, setNetwork] = useState('ethereum');
  const [customNetwork, setCustomNetwork] = useState('');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [address, setAddress] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [targetPrice, setTargetPrice] = useState('');
  const [stopLossPrice, setStopLossPrice] = useState('');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [leverage, setLeverage] = useState('3');
  const [entryPrice, setEntryPrice] = useState('');
  const [marginMode, setMarginMode] = useState<'cross' | 'isolated'>(
    'isolated',
  );
  const [marginCollateral, setMarginCollateral] = useState('');
  const [maintenanceMarginRate, setMaintenanceMarginRate] = useState('0.5');
  const [platformChoice, setPlatformChoice] = useState('');
  const [customPlatform, setCustomPlatform] = useState('');
  const [error, setError] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const inferred: EntryPriceSource =
        existing?.source === 'hyperliquid' || existing?.source === 'lighter'
          ? 'manual'
          : (existing?.source ?? 'coingecko');
      setMode(inferred);
      setPositionType(
        existing?.source === 'yahoo'
          ? 'spot'
          : (existing?.positionType ?? defaultPositionType),
      );
      setAssetClass(existing?.assetClass ?? 'spot');
      setQuery(
        existing?.source === 'yahoo'
          ? (existing.marketRef ?? existing.symbol)
          : (existing?.name ?? ''),
      );
      setSelected(
        existing && (existing.coinId || existing.source === 'yahoo')
          ? {
              id:
                existing.coinId ??
                `stock:${existing.marketRef ?? existing.symbol}`,
              name: existing.name,
              symbol: existing.symbol,
              network: existing.network ?? 'Market asset',
            }
          : null,
      );
      setAmount(existing ? String(existing.amount) : '');
      setCostBasis(existing?.costBasis ? String(existing.costBasis) : '');
      setNetwork(
        existing?.network?.toLowerCase().replaceAll(' ', '-') ?? 'ethereum',
      );
      setCustomNetwork(
        existing?.source === 'manual' ? (existing.network ?? '') : '',
      );
      setName(existing?.name ?? '');
      setSymbol(existing?.symbol ?? '');
      setAddress(existing?.address ?? '');
      setManualPrice(
        existing?.manualPrice != null
          ? String(existing.manualPrice)
          : existing?.source === 'hyperliquid' && existing.price != null
            ? String(existing.price)
            : '',
      );
      setTargetPrice(existing?.targetPrice ? String(existing.targetPrice) : '');
      setStopLossPrice(
        existing?.stopLossPrice ? String(existing.stopLossPrice) : '',
      );
      setSide(existing?.side ?? 'long');
      setLeverage(String(existing?.leverage ?? 3));
      setEntryPrice(existing?.entryPrice ? String(existing.entryPrice) : '');
      setMarginMode(existing?.marginMode ?? 'isolated');
      setMarginCollateral(
        existing?.marginCollateral ? String(existing.marginCollateral) : '',
      );
      setMaintenanceMarginRate(String(existing?.maintenanceMarginRate ?? 0.5));
      const existingPlatform = existing ? inferPlatform(existing) : '';
      setPlatformChoice(
        existingPlatform && PLATFORMS.some((item) => item === existingPlatform)
          ? existingPlatform
          : existingPlatform
            ? '__custom'
            : '',
      );
      setCustomPlatform(
        existingPlatform && !PLATFORMS.some((item) => item === existingPlatform)
          ? existingPlatform
          : '',
      );
      setError('');
    });
    return () => {
      active = false;
    };
  }, [open, existing, defaultPositionType]);

  useEffect(() => {
    if (
      !open ||
      !['coingecko', 'yahoo'].includes(mode) ||
      selected?.name === query ||
      (mode === 'yahoo' && selected?.symbol === query)
    )
      return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(
          `${mode === 'yahoo' ? '/api/stock/search' : '/api/search'}?q=${encodeURIComponent(query)}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as { results?: AssetOption[] };
        setResults(
          data.results?.length
            ? data.results
            : mode === 'coingecko'
              ? CURATED_ASSETS.slice(0, 10)
              : [],
        );
      } catch {
        if (!controller.signal.aborted)
          setResults(mode === 'coingecko' ? CURATED_ASSETS.slice(0, 10) : []);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 260);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, mode, open, selected]);

  const resolvedNetwork = useMemo(
    () => (network === 'custom' ? customNetwork.trim().toLowerCase() : network),
    [network, customNetwork],
  );
  const resolvedPlatform =
    platformChoice === '__custom' ? customPlatform.trim() : platformChoice;

  function submit(event: { preventDefault: () => void }) {
    event.preventDefault();
    const parsedAmount = Number(amount);
    const parsedCost = costBasis ? Number(costBasis) : undefined;
    const parsedTarget = targetPrice ? Number(targetPrice) : undefined;
    const parsedStop = stopLossPrice ? Number(stopLossPrice) : undefined;
    if (!resolvedPlatform) {
      setError('Select the platform or venue where this position is held.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (
      parsedCost !== undefined &&
      (!Number.isFinite(parsedCost) || parsedCost < 0)
    ) {
      setError('Cost basis must be a valid positive number.');
      return;
    }
    if (
      parsedTarget !== undefined &&
      (!Number.isFinite(parsedTarget) || parsedTarget <= 0)
    ) {
      setError('Price target must be greater than zero.');
      return;
    }
    if (
      parsedStop !== undefined &&
      (!Number.isFinite(parsedStop) || parsedStop <= 0)
    ) {
      setError('Stop-loss price must be greater than zero.');
      return;
    }

    const parsedEntry = Number(entryPrice);
    const parsedLeverage = Number(leverage);
    const parsedMargin = marginCollateral
      ? Number(marginCollateral)
      : undefined;
    const parsedMaintenance = Number(maintenanceMarginRate);
    if (
      positionType === 'perp' &&
      (!Number.isFinite(parsedEntry) ||
        parsedEntry <= 0 ||
        !Number.isFinite(parsedLeverage) ||
        parsedLeverage < 1 ||
        parsedLeverage > 100)
    ) {
      setError(
        'Perpetual positions require an entry price and leverage between 1× and 100×.',
      );
      return;
    }
    if (
      positionType === 'perp' &&
      parsedMargin !== undefined &&
      (!Number.isFinite(parsedMargin) || parsedMargin <= 0)
    ) {
      setError('Allocated margin must be greater than zero.');
      return;
    }
    if (
      positionType === 'perp' &&
      (!Number.isFinite(parsedMaintenance) ||
        parsedMaintenance < 0 ||
        parsedMaintenance >= 20)
    ) {
      setError('Maintenance margin should be a percentage between 0% and 20%.');
      return;
    }
    if (
      positionType === 'perp' &&
      parsedTarget !== undefined &&
      (side === 'long'
        ? parsedTarget <= parsedEntry
        : parsedTarget >= parsedEntry)
    ) {
      setError(
        `${side === 'long' ? 'Long' : 'Short'} take-profit must be ${side === 'long' ? 'above' : 'below'} the entry price.`,
      );
      return;
    }
    if (
      positionType === 'perp' &&
      parsedStop !== undefined &&
      (side === 'long' ? parsedStop >= parsedEntry : parsedStop <= parsedEntry)
    ) {
      setError(
        `${side === 'long' ? 'Long' : 'Short'} stop-loss must be ${side === 'long' ? 'below' : 'above'} the entry price.`,
      );
      return;
    }

    const base = {
      id: existing?.id ?? crypto.randomUUID(),
      amount: parsedAmount,
      instrumentType:
        mode === 'yahoo' ? ('stock' as const) : ('crypto' as const),
      costBasis: positionType === 'spot' ? parsedCost : undefined,
      positionType,
      assetClass: positionType === 'spot' ? assetClass : undefined,
      platform: resolvedPlatform,
      targetPrice: parsedTarget,
      stopLossPrice: positionType === 'perp' ? parsedStop : undefined,
      ...(positionType === 'perp'
        ? {
            side,
            leverage: parsedLeverage,
            entryPrice: parsedEntry,
            marginMode,
            marginCollateral:
              parsedMargin ?? (parsedAmount * parsedEntry) / parsedLeverage,
            maintenanceMarginRate: parsedMaintenance,
          }
        : {}),
      color: existing?.color ?? COLORS[colorIndex % COLORS.length],
      price: existing?.price,
      change24h: existing?.change24h,
      marketCap: existing?.marketCap,
      volume24h: existing?.volume24h,
      liquidity: existing?.liquidity,
      provider: existing?.provider,
      updatedAt: existing?.updatedAt,
      importedFrom: existing?.importedFrom,
      importProfileId: existing?.importProfileId,
      importContributions: existing?.importContributions,
      walletAddress: existing?.walletAddress,
      importedAt: existing?.importedAt,
      accountLabel: existing?.accountLabel,
      accountMode: existing?.accountMode,
    };

    let holding: Holding;
    if (mode === 'coingecko') {
      if (!selected) {
        setError('Choose a market asset from the search results.');
        return;
      }
      holding = {
        ...base,
        source: mode,
        coinId: selected.id,
        name: selected.name,
        symbol: selected.symbol.toUpperCase(),
        network: selected.network,
      };
    } else if (mode === 'yahoo') {
      const ticker = cleanTicker(selected?.symbol ?? query);
      if (!ticker) {
        setError('Enter a valid US stock or ETF ticker, such as AAPL or SPY.');
        return;
      }
      holding = {
        ...base,
        source: mode,
        instrumentType: 'stock',
        marketRef: ticker,
        name: selected?.name ?? ticker,
        symbol: ticker,
        network: selected?.network ?? 'US market',
      };
    } else if (mode === 'dexscreener') {
      if (
        !name.trim() ||
        !symbol.trim() ||
        !address.trim() ||
        !resolvedNetwork
      ) {
        setError('Name, symbol, chain and contract address are required.');
        return;
      }
      holding = {
        ...base,
        source: mode,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        network: resolvedNetwork,
        address: address.trim(),
      };
    } else {
      const parsedPrice = Number(manualPrice);
      if (
        !name.trim() ||
        !symbol.trim() ||
        !Number.isFinite(parsedPrice) ||
        parsedPrice < 0
      ) {
        setError('Name, symbol and a valid current price are required.');
        return;
      }
      holding = {
        ...base,
        source: mode,
        name: name.trim(),
        symbol: symbol.trim().toUpperCase(),
        network: customNetwork.trim() || 'Manual',
        manualPrice: parsedPrice,
        price: parsedPrice,
        provider: 'Manual',
        updatedAt: Date.now(),
      };
    }

    onSave(holding);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border border-white/10 bg-[#111412] p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b border-white/[0.07] px-6 py-5">
          <DialogTitle className="text-lg font-semibold tracking-[-0.035em]">
            {existing ? 'Edit position' : 'Enter position'}
          </DialogTitle>
          <DialogDescription className="text-xs text-white/40">
            {existing
              ? 'Update position details, risk inputs, or your price target.'
              : 'Track crypto, stock holdings or leveraged perpetual positions.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit}>
          <div className="px-6 py-5">
            {mode !== 'yahoo' ? (
              <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1">
                <PositionButton
                  active={positionType === 'spot'}
                  onClick={() => setPositionType('spot')}
                  icon={WalletCards}
                  label="Spot"
                  detail="Owned asset"
                />
                <PositionButton
                  active={positionType === 'perp'}
                  onClick={() => setPositionType('perp')}
                  icon={TrendingUp}
                  label="Perpetual"
                  detail="Leveraged contract"
                />
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-[#7b82ff]/15 bg-[#7b82ff]/[0.045] px-3 py-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-[#7b82ff]/10 text-[#9da2ff]">
                  <ChartNoAxesCombined className="size-4" />
                </span>
                <div>
                  <p className="text-[11px] font-semibold">Stock holding</p>
                  <p className="mt-0.5 text-[8px] text-white/30">
                    Shares valued from the latest US-market quote
                  </p>
                </div>
              </div>
            )}

            {!existing && (
              <div className="mt-3 grid grid-cols-4 gap-1 rounded-xl border border-white/[0.07] bg-black/20 p-1">
                <ModeButton
                  active={mode === 'coingecko'}
                  onClick={() => {
                    setMode('coingecko');
                    setSelected(null);
                    setQuery('');
                    setResults(CURATED_ASSETS.slice(0, 10));
                  }}
                  icon={Coins}
                  label="Crypto"
                />
                <ModeButton
                  active={mode === 'yahoo'}
                  onClick={() => {
                    setMode('yahoo');
                    setPositionType('spot');
                    setAssetClass('spot');
                    setSelected(null);
                    setQuery('');
                    setResults([]);
                  }}
                  icon={ChartNoAxesCombined}
                  label="Stocks"
                />
                <ModeButton
                  active={mode === 'dexscreener'}
                  onClick={() => {
                    setMode('dexscreener');
                    setSelected(null);
                  }}
                  icon={Waypoints}
                  label="Onchain"
                />
                <ModeButton
                  active={mode === 'manual'}
                  onClick={() => {
                    setMode('manual');
                    setSelected(null);
                  }}
                  icon={Database}
                  label="Manual"
                />
              </div>
            )}

            {(mode === 'coingecko' || mode === 'yahoo') && (
              <div className="mt-5">
                <Label>
                  {mode === 'yahoo'
                    ? 'Search US stocks and ETFs'
                    : 'Search any listed crypto'}
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/25" />
                  <Input
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSelected(null);
                    }}
                    placeholder={
                      mode === 'yahoo'
                        ? 'AAPL, NVDA, SPY…'
                        : 'Bitcoin, ETH, Solana…'
                    }
                    className="h-11 rounded-xl border-white/10 bg-white/[0.035] pl-10 text-sm focus-visible:border-[#d8ff58]/60 focus-visible:ring-[#d8ff58]/10"
                  />
                  {searching && (
                    <span className="absolute right-3 top-1/2 size-3 -translate-y-1/2 animate-spin rounded-full border border-white/20 border-t-[#d8ff58]" />
                  )}
                </div>
                {!selected && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-white/[0.07] bg-black/15 p-1">
                    {results.map((asset) => (
                      <button
                        type="button"
                        key={asset.id}
                        onClick={() => {
                          setSelected(asset);
                          setQuery(
                            mode === 'yahoo' ? asset.symbol : asset.name,
                          );
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-white/[0.055]"
                      >
                        <span className="flex items-center gap-2.5">
                          <span className="grid size-7 place-items-center rounded-full bg-white/[0.06] text-[9px] font-bold text-white/70">
                            {asset.symbol.slice(0, 1)}
                          </span>
                          <span>
                            <span className="block text-xs font-medium">
                              {asset.name}
                            </span>
                            <span className="mt-0.5 block text-[9px] text-white/30">
                              {asset.network}
                            </span>
                          </span>
                        </span>
                        <span className="font-mono text-[10px] text-white/35">
                          {asset.symbol}
                        </span>
                      </button>
                    ))}
                    {!results.length && (
                      <p className="px-3 py-5 text-center text-xs text-white/35">
                        No matching assets found.
                      </p>
                    )}
                  </div>
                )}
                {selected && (
                  <div className="mt-2 flex items-center justify-between rounded-xl border border-[#d8ff58]/20 bg-[#d8ff58]/[0.055] px-3 py-2.5">
                    <div>
                      <p className="text-xs font-semibold">{selected.name}</p>
                      <p className="mt-0.5 text-[9px] text-white/35">
                        {mode === 'yahoo'
                          ? `${selected.symbol} · ${selected.network}`
                          : `CoinGecko ID · ${selected.id}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(null);
                        setQuery('');
                      }}
                      className="text-[10px] font-medium text-[#d8ff58]"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>
            )}

            {mode === 'dexscreener' && (
              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-[1fr_110px] gap-3">
                  <Field label="Token name">
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Robinhood Token"
                      className="form-input"
                    />
                  </Field>
                  <Field label="Symbol">
                    <Input
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                      placeholder="RHT"
                      className="form-input uppercase"
                    />
                  </Field>
                </div>
                <Field label="Chain">
                  <select
                    value={network}
                    onChange={(e) => setNetwork(e.target.value)}
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] px-3 text-xs text-white outline-none focus:border-[#d8ff58]/60"
                  >
                    {NETWORKS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                    <option value="custom">Other / custom chain slug</option>
                  </select>
                </Field>
                {network === 'custom' && (
                  <Field label="DEX Screener chain slug">
                    <Input
                      value={customNetwork}
                      onChange={(e) => setCustomNetwork(e.target.value)}
                      placeholder="e.g. robinhood"
                      className="form-input"
                    />
                  </Field>
                )}
                <Field label="Contract address">
                  <Input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="0x… or token address"
                    className="form-input font-mono text-[11px]"
                  />
                </Field>
                <p className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3 text-[10px] leading-4 text-white/35">
                  Tessera selects the most liquid USD pair found on DEX
                  Screener. For a new chain, use its exact DEX Screener chain
                  slug.
                </p>
              </div>
            )}

            {mode === 'manual' && (
              <div className="mt-5 space-y-4">
                <div className="grid grid-cols-[1fr_110px] gap-3">
                  <Field label="Asset name">
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Private token"
                      className="form-input"
                    />
                  </Field>
                  <Field label="Symbol">
                    <Input
                      value={symbol}
                      onChange={(e) => setSymbol(e.target.value)}
                      placeholder="TOKEN"
                      className="form-input uppercase"
                    />
                  </Field>
                </div>
                <Field label="Current price (USD)">
                  <Input
                    value={manualPrice}
                    onChange={(e) => setManualPrice(e.target.value)}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    className="form-input font-mono"
                  />
                </Field>
                <Field label="Network or location (optional)">
                  <Input
                    value={customNetwork}
                    onChange={(e) => setCustomNetwork(e.target.value)}
                    placeholder="Cold wallet, Robinhood Chain…"
                    className="form-input"
                  />
                </Field>
              </div>
            )}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Platform / venue">
                <select
                  value={platformChoice}
                  onChange={(event) => {
                    setPlatformChoice(event.target.value);
                    setError('');
                  }}
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] px-3 text-xs text-white outline-none focus:border-[#d8ff58]/60"
                >
                  <option value="" disabled>
                    Select where it is held
                  </option>
                  {PLATFORMS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                  <option value="__custom">Other / custom platform</option>
                </select>
              </Field>
              {platformChoice === '__custom' ? (
                <Field label="Custom platform">
                  <Input
                    value={customPlatform}
                    onChange={(event) => setCustomPlatform(event.target.value)}
                    placeholder="Exchange, wallet or protocol"
                    className="form-input"
                  />
                </Field>
              ) : (
                <div className="flex items-end">
                  <p className="pb-2 text-[9px] leading-4 text-white/28">
                    Used to keep the same asset separate across venues and
                    calculate platform equity.
                  </p>
                </div>
              )}
            </div>

            {positionType === 'spot' ? (
              <div
                className={`mt-5 grid gap-4 ${mode === 'yahoo' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}
              >
                <Field
                  label={mode === 'yahoo' ? 'Shares owned' : 'Amount owned'}
                >
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00"
                    className="form-input font-mono"
                  />
                </Field>
                <Field
                  label={
                    mode === 'yahoo'
                      ? 'Average cost per share (optional)'
                      : 'Avg. cost per coin (optional)'
                  }
                >
                  <Input
                    value={costBasis}
                    onChange={(e) => setCostBasis(e.target.value)}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0.00 USD"
                    className="form-input font-mono"
                  />
                </Field>
                {mode !== 'yahoo' && (
                  <Field label="Holding state">
                    <select
                      value={assetClass}
                      onChange={(event) =>
                        setAssetClass(event.target.value as AssetClass)
                      }
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] px-3 text-xs text-white outline-none focus:border-[#d8ff58]/60"
                    >
                      <option value="spot">Liquid spot</option>
                      <option value="staked">Staked</option>
                      <option value="unstaking">Unstaking / locked</option>
                    </select>
                  </Field>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-white/[0.075] bg-black/15 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold">
                      Perpetual risk inputs
                    </p>
                    <p className="mt-1 text-[9px] text-white/30">
                      Used for margin, P&L, ROE and liquidation estimates.
                    </p>
                  </div>
                  <span className="rounded-full border border-[#d8ff58]/15 px-2 py-1 text-[8px] uppercase tracking-[0.14em] text-[#d8ff58]/70">
                    Derivatives
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[0.035] p-1">
                  <button
                    type="button"
                    onClick={() => setSide('long')}
                    className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-[10px] font-semibold transition ${side === 'long' ? 'bg-[#d8ff58]/12 text-[#d8ff58]' : 'text-white/30 hover:text-white/60'}`}
                  >
                    <ArrowUpRight className="size-3.5" /> Long
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide('short')}
                    className={`flex h-9 items-center justify-center gap-1.5 rounded-lg text-[10px] font-semibold transition ${side === 'short' ? 'bg-[#ff7777]/12 text-[#ff8585]' : 'text-white/30 hover:text-white/60'}`}
                  >
                    <ArrowDownRight className="size-3.5" /> Short
                  </button>
                </div>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Position quantity">
                    <Input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00 coins"
                      className="form-input font-mono"
                    />
                  </Field>
                  <Field label="Entry price (USD)">
                    <Input
                      value={entryPrice}
                      onChange={(e) => setEntryPrice(e.target.value)}
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      className="form-input font-mono"
                    />
                  </Field>
                  <Field label="Leverage">
                    <Input
                      value={leverage}
                      onChange={(e) => setLeverage(e.target.value)}
                      type="number"
                      min="1"
                      max="100"
                      step="0.1"
                      placeholder="3×"
                      className="form-input font-mono"
                    />
                  </Field>
                  <Field label="Allocated margin (optional)">
                    <Input
                      value={marginCollateral}
                      onChange={(e) => setMarginCollateral(e.target.value)}
                      type="number"
                      min="0"
                      step="any"
                      placeholder="Auto from leverage"
                      className="form-input font-mono"
                    />
                  </Field>
                  <Field label="Margin mode">
                    <select
                      value={marginMode}
                      onChange={(e) =>
                        setMarginMode(e.target.value as 'cross' | 'isolated')
                      }
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.035] px-3 text-xs text-white outline-none focus:border-[#d8ff58]/60"
                    >
                      <option value="isolated">Isolated</option>
                      <option value="cross">Cross / portfolio</option>
                    </select>
                  </Field>
                  <Field label="Maintenance margin %">
                    <Input
                      value={maintenanceMarginRate}
                      onChange={(e) => setMaintenanceMarginRate(e.target.value)}
                      type="number"
                      min="0"
                      max="20"
                      step="0.1"
                      placeholder="0.5"
                      className="form-input font-mono"
                    />
                  </Field>
                </div>
              </div>
            )}

            {positionType === 'spot' ? (
              <div className="mt-4">
                <Field
                  label={`${mode === 'yahoo' ? 'Stock' : 'Spot'} price target (optional)`}
                >
                  <Input
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Target market price in USD"
                    className="form-input font-mono"
                  />
                </Field>
                <p className="mt-2 text-[9px] leading-4 text-white/28">
                  Projects the future value of this holding and its contribution
                  to the portfolio target scenario.
                </p>
              </div>
            ) : (
              <div className="mt-4 grid gap-4 rounded-2xl border border-white/[0.075] bg-black/15 p-4 sm:grid-cols-2">
                <Field label="Take-profit price (optional)">
                  <Input
                    value={targetPrice}
                    onChange={(e) => setTargetPrice(e.target.value)}
                    type="number"
                    min="0"
                    step="any"
                    placeholder={
                      side === 'long' ? 'Above entry' : 'Below entry'
                    }
                    className="form-input font-mono"
                  />
                </Field>
                <Field label="Stop-loss price (optional)">
                  <Input
                    value={stopLossPrice}
                    onChange={(e) => setStopLossPrice(e.target.value)}
                    type="number"
                    min="0"
                    step="any"
                    placeholder={
                      side === 'long' ? 'Below entry' : 'Above entry'
                    }
                    className="form-input font-mono"
                  />
                </Field>
                <PerpBracketPreview
                  amount={Number(amount)}
                  entry={Number(entryPrice)}
                  target={Number(targetPrice)}
                  stop={Number(stopLossPrice)}
                  side={side}
                />
              </div>
            )}

            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl border border-[#ff7777]/20 bg-[#ff7777]/[0.06] px-3 py-2 text-[11px] text-[#ff9999]"
              >
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="m-0 flex-row justify-end rounded-none border-white/[0.07] bg-black/15 px-6 py-4">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-9 px-4 text-white/50 hover:bg-white/5 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-9 bg-[#d8ff58] px-5 text-[#090b0b] hover:bg-[#e6ff91]"
            >
              {existing ? 'Save changes' : 'Add position'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-[9px] font-medium uppercase tracking-[0.15em] text-white/35">
      {children}
    </label>
  );
}

function cleanTicker(value: string) {
  const ticker = value.trim().toUpperCase().replaceAll('.', '-');
  return /^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : '';
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Coins;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 items-center justify-center gap-2 rounded-lg text-[11px] font-medium transition ${active ? 'bg-white/[0.09] text-white shadow-sm' : 'text-white/35 hover:text-white/70'}`}
    >
      <Icon className={`size-3.5 ${active ? 'text-[#d8ff58]' : ''}`} />
      {label}
    </button>
  );
}

function PositionButton({
  active,
  onClick,
  icon: Icon,
  label,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof WalletCards;
  label: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${active ? 'bg-white/[0.09] text-white shadow-sm' : 'text-white/35 hover:text-white/70'}`}
    >
      <span
        className={`grid size-8 place-items-center rounded-lg ${active ? 'bg-[#d8ff58]/10 text-[#d8ff58]' : 'bg-white/[0.035]'}`}
      >
        <Icon className="size-4" />
      </span>
      <span>
        <span className="block text-[11px] font-semibold">{label}</span>
        <span className="mt-0.5 block text-[8px] text-white/30">{detail}</span>
      </span>
    </button>
  );
}

function PerpBracketPreview({
  amount,
  entry,
  target,
  stop,
  side,
}: {
  amount: number;
  entry: number;
  target: number;
  stop: number;
  side: 'long' | 'short';
}) {
  if (
    ![amount, entry, target, stop].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return (
      <p className="text-[9px] leading-4 text-white/28 sm:col-span-2">
        Set both exits to preview maximum planned profit, loss, and
        reward-to-risk.
      </p>
    );
  const direction = side === 'short' ? -1 : 1;
  const reward = direction * amount * (target - entry);
  const risk = Math.abs(direction * amount * (stop - entry));
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-[9px] sm:col-span-2">
      <span className="text-white/30">Bracket plan</span>
      <span className="font-mono">
        <span className="text-[#d8ff58]">
          +$
          {Math.max(0, reward).toLocaleString('en-US', {
            maximumFractionDigits: 2,
          })}
        </span>
        <span className="mx-2 text-white/15">/</span>
        <span className="text-[#ff8585]">
          -${risk.toLocaleString('en-US', { maximumFractionDigits: 2 })}
        </span>
        <span className="ml-3 text-white/45">
          {risk ? (Math.max(0, reward) / risk).toFixed(2) : '—'} R:R
        </span>
      </span>
    </div>
  );
}
