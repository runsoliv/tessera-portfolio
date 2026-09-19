'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, Trash2, X } from 'lucide-react';

import { AddAssetDialog } from '@/components/add-asset-dialog';
import { AdjustQuantityDialog } from '@/components/adjust-quantity-dialog';
import { ScreenshotImportDialog } from '@/components/screenshot-import-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  appendSnapshot,
  calculateAnalytics,
  isValidHolding,
  rebasePortfolioSnapshots,
  type PortfolioAnalytics,
} from '@/lib/analytics';
import {
  createScreenshotProfile,
  getOrCreateWalletProfile,
  migrateImportProfiles,
  parseImportProfiles,
  removeImportProfileFromHoldings,
  retainImportProfileHoldings,
  WALLET_SNAPSHOT_VERSION,
} from '@/lib/import-profiles';
import {
  COLORS,
  IMPORT_PROFILES_STORAGE_KEY,
  STORAGE_KEY,
  createDemoPortfolio,
  inferPlatform,
  normalizeHolding,
  type Holding,
  type ImportProfile,
  type PriceResult,
  type StoredPortfolio,
  type VenueHistorySeries,
} from '@/lib/portfolio';
import {
  parseVenueHistories,
  VENUE_HISTORY_VERSION,
} from '@/lib/venue-history';
import { isSuspiciousSpotPriceJump } from '@/lib/price-guard';
import type {
  QuantityAdjustment,
  WalletImportCandidate,
  WalletImportResponse,
  WalletHistoryResponse,
  WalletImportSource,
} from '@/lib/wallet-import';
import { localWalletQuantityDelta } from '@/lib/wallet-sync';
import type {
  ScreenshotImportDestination,
  ScreenshotPositionImport,
} from '@/lib/screenshot-import';

export type RefreshState = 'idle' | 'loading' | 'success' | 'warning' | 'error';

type PortfolioContextValue = {
  portfolio: StoredPortfolio;
  analytics: PortfolioAnalytics;
  hydrated: boolean;
  refreshState: RefreshState;
  historyRefreshState: RefreshState;
  notice: string | null;
  importProfiles: ImportProfile[];
  refreshPrices: (holdings?: Holding[]) => Promise<void>;
  refreshPortfolio: () => Promise<void>;
  refreshVenueHistories: (force?: boolean) => Promise<void>;
  syncImportProfile: (profileId: string) => Promise<boolean>;
  openAdd: (positionType?: 'spot' | 'perp') => void;
  openEdit: (holding: Holding) => void;
  openAdjust: (holding: Holding) => void;
  openScreenshotImport: () => void;
  renameImportProfile: (id: string, name: string) => void;
  removeImportProfile: (id: string) => void;
  requestDelete: (holding: Holding) => void;
  mergeWalletPositions: (
    items: WalletImportCandidate[],
    source: WalletImportSource,
    address: string,
    warnings?: string[],
  ) => { added: number; merged: number };
  updateHolding: (id: string, patch: Partial<Holding>) => void;
  setPrivacyMode: (value: boolean) => void;
  setAutoRefresh: (value: boolean) => void;
  setMinimumPositionValue: (value: number) => void;
  dismissSample: () => void;
  startFresh: () => void;
  resetSample: () => void;
  exportPortfolio: () => void;
  importPortfolio: (file: File) => Promise<boolean>;
  setNotice: (message: string | null) => void;
};

const PortfolioContext = createContext<PortfolioContextValue | null>(null);
const EMPTY_PORTFOLIO: StoredPortfolio = {
  version: 1,
  holdings: [],
  snapshots: [],
  venueHistories: [],
  autoRefresh: true,
  privacyMode: false,
  minimumPositionValue: 10,
};

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const [portfolio, setPortfolio] = useState<StoredPortfolio | null>(null);
  const portfolioRef = useRef<StoredPortfolio | null>(null);
  const [importProfiles, setImportProfiles] = useState<ImportProfile[]>([]);
  const importProfilesRef = useRef<ImportProfile[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [refreshState, setRefreshState] = useState<RefreshState>('idle');
  const [historyRefreshState, setHistoryRefreshState] =
    useState<RefreshState>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Holding | null>(null);
  const [adjusting, setAdjusting] = useState<Holding | null>(null);
  const [deleting, setDeleting] = useState<Holding | null>(null);
  const [screenshotImportOpen, setScreenshotImportOpen] = useState(false);
  const [defaultPositionType, setDefaultPositionType] = useState<
    'spot' | 'perp'
  >('spot');
  const portfolioRefreshInFlight = useRef(false);

  const refreshVenueHistories = useCallback(
    async (
      force = false,
      profileOverride?: ImportProfile[],
      announce = true,
    ) => {
      const profiles = (profileOverride ?? importProfilesRef.current).filter(
        (profile) =>
          (profile.source === 'hyperliquid' || profile.source === 'lighter') &&
          Boolean(profile.address),
      );
      const current = portfolioRef.current;
      if (!current || !profiles.length) return;
      const saved = parseVenueHistories(current.venueHistories);
      const staleAfter = Date.now() - 6 * 60 * 60 * 1_000;
      const pending = profiles.filter((profile) => {
        const existing = saved.find(
          (history) => history.profileId === profile.id,
        );
        return (
          force ||
          !existing ||
          existing.historyVersion !== VENUE_HISTORY_VERSION ||
          existing.fetchedAt < staleAfter
        );
      });
      if (!pending.length) return;

      setHistoryRefreshState('loading');
      const results = await Promise.allSettled(
        pending.map(async (profile) => {
          const response = await fetch('/api/wallet/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              source: profile.source,
              address: profile.address,
            }),
          });
          const data = (await response.json()) as WalletHistoryResponse & {
            error?: string;
          };
          if (!response.ok || !data.history)
            throw new Error(
              data.error || `${profile.platform} history could not be loaded.`,
            );
          return {
            profile,
            history: {
              ...data.history,
              profileId: profile.id,
            } satisfies VenueHistorySeries,
          };
        }),
      );
      const completed = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      const failures = results.filter(
        (result) => result.status === 'rejected',
      ).length;
      const warnings = completed.filter((result) => result.history.warning);

      if (completed.length) {
        setPortfolio((latest) => {
          if (!latest) return latest;
          const completedIds = new Set(
            completed.map((result) => result.profile.id),
          );
          return {
            ...latest,
            venueHistories: [
              ...parseVenueHistories(latest.venueHistories).filter(
                (history) => !completedIds.has(history.profileId),
              ),
              ...completed.map((result) => result.history),
            ],
          };
        });
      }

      if (failures || warnings.length) {
        setHistoryRefreshState('warning');
        if (announce) {
          const firstWarning = warnings[0]?.history.warning;
          setNotice(
            firstWarning ??
              `${failures} venue histor${failures === 1 ? 'y' : 'ies'} could not be refreshed. Existing chart data was retained.`,
          );
        }
      } else {
        setHistoryRefreshState('success');
        if (announce) {
          const points = completed.reduce(
            (sum, result) => sum + result.history.points.length,
            0,
          );
          setNotice(
            `${points.toLocaleString()} historical venue point${points === 1 ? '' : 's'} synced.`,
          );
        }
      }
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const rawProfiles = window.localStorage.getItem(
          IMPORT_PROFILES_STORAGE_KEY,
        );
        const savedProfiles = parseStoredImportProfiles(rawProfiles);
        let nextPortfolio: StoredPortfolio;
        if (raw) {
          const parsed = JSON.parse(raw) as StoredPortfolio;
          if (
            parsed?.version === 1 &&
            Array.isArray(parsed.holdings) &&
            Array.isArray(parsed.snapshots)
          ) {
            nextPortfolio = {
              ...parsed,
              holdings: parsed.holdings.map(normalizeHolding),
              venueHistories: parseVenueHistories(parsed.venueHistories),
              autoRefresh: parsed.autoRefresh ?? true,
              privacyMode: parsed.privacyMode ?? false,
              minimumPositionValue: normalizeMinimumValue(
                parsed.minimumPositionValue,
              ),
            };
          } else {
            nextPortfolio = createDemoPortfolio();
          }
        } else {
          nextPortfolio = createDemoPortfolio();
        }
        const migrated = migrateImportProfiles(
          nextPortfolio.holdings,
          savedProfiles,
        );
        nextPortfolio = { ...nextPortfolio, holdings: migrated.holdings };
        portfolioRef.current = nextPortfolio;
        importProfilesRef.current = migrated.profiles;
        setPortfolio(nextPortfolio);
        setImportProfiles(migrated.profiles);
      } catch {
        const fallback = createDemoPortfolio();
        portfolioRef.current = fallback;
        importProfilesRef.current = [];
        setPortfolio(fallback);
        setImportProfiles([]);
        setNotice(
          'Saved data could not be read, so the sample portfolio was loaded.',
        );
      } finally {
        setHydrated(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const attemptedInitialHistorySync = useRef(false);
  useEffect(() => {
    if (
      !hydrated ||
      attemptedInitialHistorySync.current ||
      !importProfiles.length
    )
      return;
    attemptedInitialHistorySync.current = true;
    void refreshVenueHistories(false, undefined, false);
  }, [hydrated, importProfiles.length, refreshVenueHistories]);

  useEffect(() => {
    portfolioRef.current = portfolio;
    if (hydrated && portfolio)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
  }, [portfolio, hydrated]);

  useEffect(() => {
    importProfilesRef.current = importProfiles;
    if (hydrated)
      window.localStorage.setItem(
        IMPORT_PROFILES_STORAGE_KEY,
        JSON.stringify(importProfiles),
      );
  }, [importProfiles, hydrated]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const refreshPrices = useCallback(
    async (forcedHoldings?: Holding[], compositionChange = false) => {
      const activeHoldings = (
        forcedHoldings ??
        portfolioRef.current?.holdings ??
        []
      ).map(normalizeHolding);
      if (!activeHoldings.length) {
        setRefreshState('success');
        return;
      }
      setRefreshState('loading');
      try {
        const response = await fetch('/api/market', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ holdings: activeHoldings }),
        });
        if (!response.ok)
          throw new Error('The market data service did not respond.');
        const data = (await response.json()) as {
          prices: Record<string, PriceResult>;
          unresolved: string[];
          warnings: string[];
        };
        const rejectedQuoteIds = activeHoldings
          .filter((holding) => {
            const quote = data.prices[holding.id];
            return quote && isSuspiciousSpotPriceJump(holding, quote);
          })
          .map((holding) => holding.id);
        const rejectedQuoteSet = new Set(rejectedQuoteIds);
        setPortfolio((current) => {
          if (!current) return current;
          const updatedHoldings = current.holdings.map((holding) => {
            const normalized = normalizeHolding(holding);
            const quote = data.prices[holding.id];
            if (!quote || rejectedQuoteSet.has(holding.id)) return normalized;
            return normalized.importedFrom === 'hyperliquid' &&
              quote.provider === 'Hyperliquid'
              ? {
                  ...normalized,
                  ...quote,
                  source: 'hyperliquid' as const,
                  manualPrice: undefined,
                }
              : { ...normalized, ...quote };
          });
          const value = calculateAnalytics(
            updatedHoldings,
            current.minimumPositionValue,
          ).totalValue;
          const previousValue = calculateAnalytics(
            current.holdings,
            current.minimumPositionValue,
          ).totalValue;
          const adjustedSnapshots = compositionChange
            ? rebasePortfolioSnapshots(current.snapshots, value - previousValue)
            : current.snapshots;
          return {
            ...current,
            holdings: updatedHoldings,
            snapshots: appendSnapshot(adjustedSnapshots, value),
          };
        });
        const retainedPrices = data.unresolved.length + rejectedQuoteIds.length;
        if (retainedPrices) {
          setRefreshState('warning');
          setNotice(
            `${retainedPrices} position${retainedPrices === 1 ? '' : 's'} kept the last known price.`,
          );
        } else {
          setRefreshState('success');
        }
      } catch (error) {
        setRefreshState('error');
        setNotice(
          error instanceof Error
            ? `${error.message} Cached prices are still shown.`
            : 'Price refresh failed. Cached prices are still shown.',
        );
      }
    },
    [],
  );

  const syncImportProfile = useCallback(
    async (profileId: string, announce = true, followUp = true) => {
      const profile = importProfilesRef.current.find(
        (candidate) => candidate.id === profileId,
      );
      const current = portfolioRef.current;
      if (
        !profile ||
        !current ||
        !profile.address ||
        (profile.source !== 'hyperliquid' && profile.source !== 'lighter')
      )
        return false;

      try {
        const response = await fetch('/api/wallet/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: profile.source,
            address: profile.address,
          }),
        });
        const data = (await response.json()) as WalletImportResponse & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            data.error || `${profile.name} could not be synchronized.`,
          );

        const nextHoldings = replaceWalletProfileSnapshot(
          current.holdings,
          data.items,
          profile.source,
          profile.address,
          profile.id,
          data.warnings,
        );
        const incompleteKinds = incompleteWalletSnapshotKinds(
          profile.source,
          data.warnings,
        );
        const previousPerps = current.holdings.filter(
          (holding) =>
            holding.importProfileId === profile.id &&
            holding.positionType === 'perp',
        );
        const nextPerps = nextHoldings.filter(
          (holding) =>
            holding.importProfileId === profile.id &&
            holding.positionType === 'perp',
        );
        const nextPerpIds = new Set(nextPerps.map((holding) => holding.id));
        const closedPerps = previousPerps.filter(
          (holding) => !nextPerpIds.has(holding.id),
        ).length;
        const nextProfiles = importProfilesRef.current.map((candidate) =>
          candidate.id === profile.id
            ? {
                ...candidate,
                lastImportedAt: data.fetchedAt,
                snapshotVersion: incompleteKinds.size
                  ? candidate.snapshotVersion
                  : WALLET_SNAPSHOT_VERSION,
              }
            : candidate,
        );
        importProfilesRef.current = nextProfiles;
        setImportProfiles(nextProfiles);
        const nextPortfolio = {
          ...portfolioWithRebasedHoldings(current, nextHoldings),
          sampleMode: false,
        };
        portfolioRef.current = nextPortfolio;
        setPortfolio(nextPortfolio);
        if (followUp) {
          window.setTimeout(() => void refreshPrices(nextHoldings, true), 0);
          window.setTimeout(
            () => void refreshVenueHistories(true, nextProfiles, false),
            0,
          );
        }
        if (announce)
          setNotice(
            `${profile.name} synced: ${nextPerps.length} open perpetual${nextPerps.length === 1 ? '' : 's'}${closedPerps ? `, ${closedPerps} closed` : ''}.`,
          );
        return true;
      } catch (error) {
        if (announce)
          setNotice(
            error instanceof Error
              ? error.message
              : `${profile.name} could not be synchronized.`,
          );
        return false;
      }
    },
    [refreshPrices, refreshVenueHistories],
  );

  const refreshPortfolio = useCallback(async () => {
    if (portfolioRefreshInFlight.current) return;
    portfolioRefreshInFlight.current = true;
    setRefreshState('loading');
    try {
      const profiles = importProfilesRef.current.filter(
        (profile) =>
          (profile.source === 'hyperliquid' || profile.source === 'lighter') &&
          Boolean(profile.address),
      );
      let failures = 0;
      for (const profile of profiles) {
        if (!(await syncImportProfile(profile.id, false, false))) failures += 1;
      }
      await refreshPrices();
      if (failures) {
        setRefreshState('warning');
        setNotice(
          `${failures} venue wallet${failures === 1 ? '' : 's'} could not sync. Existing positions were kept.`,
        );
      }
      if (profiles.length) void refreshVenueHistories(false, undefined, false);
    } finally {
      portfolioRefreshInFlight.current = false;
    }
    // oxlint-disable-next-line react/react-compiler -- Required by exhaustive-deps; all three callbacks are stable.
  }, [refreshPrices, refreshVenueHistories, syncImportProfile]);

  useEffect(() => {
    if (!hydrated) return;
    void refreshPortfolio();
  }, [hydrated, refreshPortfolio]);

  useEffect(() => {
    if (!hydrated || !portfolio?.autoRefresh) return;
    const priceTimer = window.setInterval(
      () => {
        if (!portfolioRefreshInFlight.current) void refreshPrices();
      },
      60_000,
    );
    const walletTimer = window.setInterval(
      () => void refreshPortfolio(),
      120_000,
    );
    return () => {
      window.clearInterval(priceTimer);
      window.clearInterval(walletTimer);
    };
  }, [hydrated, portfolio?.autoRefresh, refreshPortfolio, refreshPrices]);

  const saveHolding = useCallback(
    (holding: Holding) => {
      const current = portfolioRef.current;
      if (!current) return;
      const exists = current.holdings.some((item) => item.id === holding.id);
      const normalizedHolding = reconcileImportContributions(
        normalizeHolding(holding),
      );
      const nextHoldings = exists
        ? current.holdings.map((item) =>
            item.id === holding.id ? normalizedHolding : item,
          )
        : [...current.holdings, normalizedHolding];
      setPortfolio({
        ...portfolioWithRebasedHoldings(current, nextHoldings),
        sampleMode: false,
      });
      setEditing(null);
      setNotice(
        `${holding.symbol} ${exists ? 'updated' : 'added'} successfully.`,
      );
      window.setTimeout(() => void refreshPrices(nextHoldings, true), 0);
    },
    [refreshPrices],
  );

  const updateHolding = useCallback((id: string, patch: Partial<Holding>) => {
    const current = portfolioRef.current;
    if (!current) return;
    const holding = current.holdings.find((item) => item.id === id);
    if (!holding) return;
    const nextHoldings = current.holdings.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
    setPortfolio({
      ...portfolioWithRebasedHoldings(current, nextHoldings),
      sampleMode: false,
    });
    setNotice(`${holding.symbol} plan updated.`);
  }, []);

  function mergeWalletPositions(
    items: WalletImportCandidate[],
    source: WalletImportSource,
    address: string,
    warnings: string[] = [],
  ) {
    const current = portfolioRef.current;
    if (!current || !items.length) return { added: 0, merged: 0 };
    const platform = items[0]?.platform || sourceName(source);
    const profileResult = getOrCreateWalletProfile({
      profiles: importProfilesRef.current,
      source,
      address,
      network: items[0]?.network,
      platform,
    });
    const incompleteKinds = incompleteWalletSnapshotKinds(source, warnings);
    const nextProfiles = profileResult.profiles.map((profile) =>
      profile.id === profileResult.profile.id
        ? {
            ...profile,
            snapshotVersion: incompleteKinds.size
              ? profile.snapshotVersion
              : WALLET_SNAPSHOT_VERSION,
          }
        : profile,
    );
    importProfilesRef.current = nextProfiles;
    setImportProfiles(nextProfiles);
    if (!profileResult.created) {
      const matched = items.filter((candidate) =>
        current.holdings.some((holding) =>
          matchesImport(holding, candidate, profileResult.profile.id),
        ),
      ).length;
      const nextHoldings = replaceWalletProfileSnapshot(
        current.holdings,
        items,
        source,
        address,
        profileResult.profile.id,
        warnings,
      );
      const nextPortfolio = {
        ...portfolioWithRebasedHoldings(current, nextHoldings),
        sampleMode: false,
      };
      portfolioRef.current = nextPortfolio;
      setPortfolio(nextPortfolio);
      setNotice(
        `${profileResult.profile.name} snapshot updated: ${items.length - matched} new, ${matched} refreshed. Quantities stay fixed until the next sync.`,
      );
      window.setTimeout(() => void refreshPrices(nextHoldings, true), 0);
      window.setTimeout(
        () => void refreshVenueHistories(true, nextProfiles, false),
        0,
      );
      return { added: items.length - matched, merged: matched };
    }
    const nextHoldings = [...current.holdings];
    let added = 0;
    let merged = 0;
    for (const candidate of items) {
      const matchIndex = nextHoldings.findIndex((holding) =>
        matchesImport(holding, candidate, profileResult.profile.id),
      );
      if (matchIndex >= 0) {
        nextHoldings[matchIndex] = mergeImportedHolding(
          nextHoldings[matchIndex],
          candidate,
          source,
          address,
          profileResult.profile.id,
        );
        merged += 1;
      } else {
        nextHoldings.push(
          candidateToHolding(
            candidate,
            source,
            address,
            profileResult.profile.id,
            nextHoldings.length,
          ),
        );
        added += 1;
      }
    }
    setPortfolio({
      ...portfolioWithRebasedHoldings(current, nextHoldings),
      sampleMode: false,
    });
    setNotice(
      `${items.length} position${items.length === 1 ? '' : 's'} saved to ${profileResult.profile.name}: ${added} new, ${merged} added to that profile.`,
    );
    window.setTimeout(() => void refreshPrices(nextHoldings, true), 0);
    window.setTimeout(
      () => void refreshVenueHistories(true, nextProfiles, false),
      0,
    );
    return { added, merged };
  }

  function adjustQuantity(holding: Holding, adjustment: QuantityAdjustment) {
    const current = portfolioRef.current;
    if (!current) return;
    const nextHoldings = current.holdings.map((item) => {
      if (item.id !== holding.id) return item;
      const increasing = adjustment.operation === 'increase';
      const nextAmount = increasing
        ? item.amount + adjustment.quantity
        : item.amount - adjustment.quantity;
      if (!(nextAmount > 0)) return item;
      if (item.positionType !== 'perp') {
        const costBasis =
          increasing && adjustment.executionPrice
            ? item.costBasis != null
              ? (item.amount * item.costBasis +
                  adjustment.quantity * adjustment.executionPrice) /
                nextAmount
              : adjustment.executionPrice
            : item.costBasis;
        return reconcileImportContributions({
          ...item,
          amount: nextAmount,
          costBasis,
        });
      }

      const currentEntry = Number(
        item.entryPrice ?? item.price ?? adjustment.executionPrice ?? 0,
      );
      const executionPrice = Number(
        adjustment.executionPrice ?? item.price ?? currentEntry,
      );
      const entryPrice =
        increasing && executionPrice > 0
          ? (item.amount * currentEntry +
              adjustment.quantity * executionPrice) /
            nextAmount
          : currentEntry;
      const currentMargin = Number(
        item.marginCollateral ??
          (item.amount * currentEntry) / Number(item.leverage ?? 1),
      );
      const marginDelta =
        adjustment.marginAmount ??
        (adjustment.quantity * executionPrice) / Number(item.leverage ?? 1);
      const marginCollateral = increasing
        ? currentMargin + marginDelta
        : currentMargin * (nextAmount / item.amount);
      const leverage =
        marginCollateral > 0
          ? Math.max(1, (nextAmount * entryPrice) / marginCollateral)
          : item.leverage;
      return reconcileImportContributions({
        ...item,
        amount: nextAmount,
        entryPrice,
        marginCollateral,
        leverage,
        equityOverride: undefined,
        equityMarkPrice: undefined,
        roeBasis: undefined,
        reportedRoe: undefined,
        reportedUnrealizedPnl: undefined,
        liquidationModel: 'estimate' as const,
        reportedLiquidationPrice: undefined,
      });
    });
    setPortfolio({
      ...portfolioWithRebasedHoldings(current, nextHoldings),
      sampleMode: false,
    });
    setAdjusting(null);
    setNotice(
      `${holding.symbol} quantity ${adjustment.operation === 'increase' ? 'increased' : 'decreased'} by ${adjustment.quantity.toLocaleString('en-US', { maximumFractionDigits: 8 })}.`,
    );
  }

  function importScreenshotPositions(
    items: ScreenshotPositionImport[],
    destination: ScreenshotImportDestination,
  ) {
    const current = portfolioRef.current;
    if (!current || !items.length) return;
    const platforms = Array.from(
      new Set(items.map((item) => item.platform.trim()).filter(Boolean)),
    );
    const platform = platforms.length === 1 ? platforms[0] : 'Multi-platform';
    const networks = Array.from(
      new Set(items.map((item) => item.network?.trim()).filter(Boolean)),
    );
    const existingProfile = destination.profileId
      ? importProfilesRef.current.find(
          (profile) =>
            profile.id === destination.profileId &&
            profile.source === 'screenshot',
        )
      : undefined;
    if (destination.profileId && !existingProfile) {
      setNotice('That saved screenshot import no longer exists.');
      return;
    }
    const updatedName = destination.profileName.trim().slice(0, 80);
    const importedAt = Date.now();
    const updatedExistingProfile = existingProfile
      ? {
          ...existingProfile,
          name: updatedName || existingProfile.name,
          lastImportedAt: importedAt,
        }
      : undefined;
    const profileResult = updatedExistingProfile
      ? {
          profile: updatedExistingProfile,
          profiles: importProfilesRef.current.map((profile) =>
            profile.id === updatedExistingProfile.id
              ? updatedExistingProfile
              : profile,
          ),
        }
      : createScreenshotProfile(
          importProfilesRef.current,
          platform,
          networks.length === 1 ? networks[0] : undefined,
          updatedName,
          importedAt,
        );
    importProfilesRef.current = profileResult.profiles;
    setImportProfiles(profileResult.profiles);
    const nextHoldings = [...current.holdings];
    let added = 0;
    let merged = 0;
    for (const originalItem of items) {
      const item = {
        ...originalItem,
        platform: profileResult.profile.platform,
      };
      const incoming = screenshotToHolding(
        item,
        profileResult.profile.id,
        nextHoldings.length,
      );
      const matchIndex = nextHoldings.findIndex((holding) =>
        matchesScreenshotHolding(holding, incoming),
      );
      if (matchIndex >= 0) {
        nextHoldings[matchIndex] = mergeScreenshotHolding(
          nextHoldings[matchIndex],
          incoming,
          profileResult.profile.id,
        );
        merged += 1;
      } else {
        nextHoldings.push(incoming);
        added += 1;
      }
    }
    setPortfolio({
      ...portfolioWithRebasedHoldings(current, nextHoldings),
      sampleMode: false,
    });
    setNotice(
      `${items.length} screenshot position${items.length === 1 ? '' : 's'} ${existingProfile ? 'added to' : 'saved as'} ${profileResult.profile.name}: ${added} new, ${merged} added to matching positions.`,
    );
    window.setTimeout(() => void refreshPrices(nextHoldings, true), 0);
  }

  function deleteHolding() {
    const current = portfolioRef.current;
    if (!deleting || !current) return;
    const nextHoldings = current.holdings.filter(
      (holding) => holding.id !== deleting.id,
    );
    setPortfolio({
      ...portfolioWithRebasedHoldings(current, nextHoldings),
      sampleMode: false,
    });
    setNotice(`${deleting.symbol} removed from the portfolio.`);
    setDeleting(null);
  }

  function startFresh() {
    const current = portfolioRef.current;
    if (!current) return;
    const profileIds = new Set(
      importProfilesRef.current.map((profile) => profile.id),
    );
    const retained = retainImportProfileHoldings(current.holdings, profileIds);
    setPortfolio({
      ...current,
      holdings: retained,
      snapshots: [],
      sampleMode: false,
    });
    setNotice(
      retained.length
        ? `Manual positions cleared. ${retained.length} saved-profile position${retained.length === 1 ? '' : 's'} retained.`
        : 'Portfolio cleared. Saved import profiles remain available.',
    );
  }

  function exportPortfolio() {
    const current = portfolioRef.current;
    if (!current) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { ...current, importProfiles: importProfilesRef.current },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tessera-portfolio-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('Portable portfolio backup exported.');
  }

  async function importPortfolio(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as StoredPortfolio & {
        importProfiles?: ImportProfile[];
      };
      const { importProfiles: backupProfiles, ...parsedPortfolio } = parsed;
      if (
        parsed?.version !== 1 ||
        !Array.isArray(parsed.holdings) ||
        !Array.isArray(parsed.snapshots)
      )
        throw new Error();
      const validHoldings = parsed.holdings
        .filter(isValidHolding)
        .slice(0, 100)
        .map((holding, index) =>
          normalizeHolding({
            ...holding,
            color: holding.color || `hsl(${index * 47} 72% 62%)`,
          }),
        );
      const migrated = migrateImportProfiles(
        validHoldings,
        parseImportProfiles(backupProfiles),
      );
      const current = portfolioRef.current ?? EMPTY_PORTFOLIO;
      const currentProfiles = importProfilesRef.current;
      const combinedProfiles = [
        ...currentProfiles,
        ...migrated.profiles.filter(
          (profile) =>
            !currentProfiles.some(
              (currentProfile) => currentProfile.id === profile.id,
            ),
        ),
      ];
      const currentProfileIds = new Set(
        currentProfiles.map((profile) => profile.id),
      );
      const retained = retainImportProfileHoldings(
        current.holdings,
        currentProfileIds,
      );
      const retainedIds = new Set(retained.map((holding) => holding.id));
      const incoming = migrated.holdings.filter(
        (holding) => !retainedIds.has(holding.id),
      );
      const nextHoldings = [...retained, ...incoming];
      importProfilesRef.current = combinedProfiles;
      setImportProfiles(combinedProfiles);
      setPortfolio({
        ...parsedPortfolio,
        holdings: nextHoldings,
        venueHistories: mergeVenueHistories(
          current.venueHistories,
          parsedPortfolio.venueHistories,
          combinedProfiles,
        ),
        autoRefresh: parsed.autoRefresh ?? true,
        privacyMode: parsed.privacyMode ?? false,
        minimumPositionValue: normalizeMinimumValue(
          parsed.minimumPositionValue,
        ),
        sampleMode: false,
      });
      setNotice(
        `${incoming.length} position${incoming.length === 1 ? '' : 's'} imported. Existing saved profiles were retained.`,
      );
      window.setTimeout(() => void refreshPrices(nextHoldings, true), 0);
      return true;
    } catch {
      setNotice('That file is not a valid Tessera portfolio backup.');
      return false;
    }
  }

  const safePortfolio = portfolio ?? EMPTY_PORTFOLIO;
  const analytics = useMemo(
    () =>
      calculateAnalytics(
        safePortfolio.holdings,
        safePortfolio.minimumPositionValue,
      ),
    [safePortfolio.holdings, safePortfolio.minimumPositionValue],
  );

  const value: PortfolioContextValue = {
    portfolio: safePortfolio,
    analytics,
    hydrated,
    refreshState,
    historyRefreshState,
    notice,
    importProfiles,
    refreshPrices,
    refreshPortfolio,
    refreshVenueHistories,
    syncImportProfile,
    openAdd: (positionType = 'spot') => {
      setEditing(null);
      setDefaultPositionType(positionType);
      setAddOpen(true);
    },
    openEdit: (holding) => {
      setEditing(holding);
      setDefaultPositionType(holding.positionType ?? 'spot');
      setAddOpen(true);
    },
    openAdjust: setAdjusting,
    openScreenshotImport: () => setScreenshotImportOpen(true),
    renameImportProfile: (id, name) => {
      const trimmed = name.trim().slice(0, 80);
      if (!trimmed) return;
      const nextProfiles = importProfilesRef.current.map((profile) =>
        profile.id === id ? { ...profile, name: trimmed } : profile,
      );
      importProfilesRef.current = nextProfiles;
      setImportProfiles(nextProfiles);
      setNotice(`Import profile renamed to ${trimmed}.`);
    },
    removeImportProfile: (id) => {
      const current = portfolioRef.current;
      const profile = importProfilesRef.current.find((item) => item.id === id);
      if (!current || !profile) return;
      const removal = removeImportProfileFromHoldings(current.holdings, id);
      const nextProfiles = importProfilesRef.current.filter(
        (item) => item.id !== id,
      );
      importProfilesRef.current = nextProfiles;
      setImportProfiles(nextProfiles);
      setPortfolio({
        ...portfolioWithRebasedHoldings(current, removal.holdings),
        venueHistories: parseVenueHistories(current.venueHistories).filter(
          (history) => history.profileId !== id,
        ),
        sampleMode: false,
      });
      setNotice(
        `${profile.name} removed from ${removal.affected} linked position${removal.affected === 1 ? '' : 's'}.`,
      );
    },
    requestDelete: setDeleting,
    mergeWalletPositions,
    updateHolding,
    setPrivacyMode: (privacyMode) =>
      setPortfolio((current) =>
        current ? { ...current, privacyMode } : current,
      ),
    setAutoRefresh: (autoRefresh) =>
      setPortfolio((current) =>
        current ? { ...current, autoRefresh } : current,
      ),
    setMinimumPositionValue: (minimumPositionValue) =>
      setPortfolio((current) =>
        current
          ? {
              ...current,
              minimumPositionValue: normalizeMinimumValue(minimumPositionValue),
            }
          : current,
      ),
    dismissSample: () =>
      setPortfolio((current) =>
        current ? { ...current, sampleMode: false } : current,
      ),
    startFresh,
    resetSample: () => {
      const current = portfolioRef.current;
      const demo = createDemoPortfolio();
      const profileIds = new Set(
        importProfilesRef.current.map((profile) => profile.id),
      );
      const retained = retainImportProfileHoldings(
        current?.holdings ?? [],
        profileIds,
      );
      setPortfolio({
        ...demo,
        holdings: [...demo.holdings, ...retained],
        venueHistories: parseVenueHistories(current?.venueHistories),
      });
      setNotice(
        retained.length
          ? `Sample restored alongside ${retained.length} saved-profile position${retained.length === 1 ? '' : 's'}.`
          : 'Sample portfolio restored.',
      );
    },
    exportPortfolio,
    importPortfolio,
    setNotice,
  };

  return (
    <PortfolioContext.Provider value={value}>
      {children}
      <AddAssetDialog
        open={addOpen}
        onOpenChange={(open) => {
          setAddOpen(open);
          if (!open) setEditing(null);
        }}
        onSave={saveHolding}
        existing={editing}
        colorIndex={safePortfolio.holdings.length}
        defaultPositionType={defaultPositionType}
      />
      <AdjustQuantityDialog
        holding={adjusting}
        open={Boolean(adjusting)}
        onOpenChange={(open) => {
          if (!open) setAdjusting(null);
        }}
        onAdjust={adjustQuantity}
      />
      <ScreenshotImportDialog
        open={screenshotImportOpen}
        onOpenChange={setScreenshotImportOpen}
        onImport={importScreenshotPositions}
        importProfiles={importProfiles}
        minimumPositionValue={safePortfolio.minimumPositionValue}
      />
      <Dialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent className="border border-white/10 bg-[#111412] sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Remove {deleting?.symbol}?</DialogTitle>
            <DialogDescription>
              This removes the position from your local portfolio. Other
              positions and saved history remain intact.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-white/[0.07] bg-black/10">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteHolding}>
              <Trash2 className="size-3.5" /> Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {notice && (
        <output
          aria-live="polite"
          className="fixed bottom-5 left-1/2 z-[80] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-xl border border-white/10 bg-[#181b19]/95 px-4 py-3 text-[11px] text-white/70 shadow-2xl backdrop-blur-xl"
        >
          <Check className="size-3.5 shrink-0 text-[#d8ff58]" />
          {notice}
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss message"
            className="ml-2 text-white/25 hover:text-white"
          >
            <X className="size-3.5" />
          </button>
        </output>
      )}
    </PortfolioContext.Provider>
  );
}

function screenshotToHolding(
  item: ScreenshotPositionImport,
  importProfileId: string,
  colorIndex: number,
): Holding {
  const liveCrypto = item.assetType === 'crypto' && Boolean(item.coinId);
  const source =
    item.assetType === 'stock'
      ? ('yahoo' as const)
      : liveCrypto
        ? ('coingecko' as const)
        : ('coingecko' as const);
  const entryPrice = Number(item.entryPrice);
  const leverage = Math.max(1, Math.min(100, Number(item.leverage) || 1));
  const perp = item.positionType === 'perp';
  return normalizeHolding({
    id: crypto.randomUUID(),
    name: item.name || item.symbol,
    symbol: item.symbol.toUpperCase(),
    amount: item.amount,
    source,
    instrumentType: item.assetType === 'stock' ? 'stock' : 'crypto',
    coinId: liveCrypto ? item.coinId : undefined,
    network: item.network,
    marketRef:
      item.assetType === 'stock' ? item.symbol.toUpperCase() : undefined,
    positionType: item.positionType,
    assetClass: perp ? undefined : 'spot',
    platform: item.platform,
    accountLabel: 'Screenshot OCR',
    side: perp ? item.side : undefined,
    leverage: perp ? leverage : undefined,
    entryPrice: perp && entryPrice > 0 ? entryPrice : undefined,
    marginMode: perp ? 'isolated' : undefined,
    marginCollateral:
      perp && entryPrice > 0
        ? (item.amount * entryPrice) / leverage
        : undefined,
    maintenanceMarginRate: perp ? 0.5 : undefined,
    liquidationModel: perp ? 'estimate' : undefined,
    price: undefined,
    change24h: null,
    marketCap: null,
    volume24h: null,
    liquidity: null,
    provider:
      source === 'yahoo'
        ? 'Yahoo Finance · quote pending'
        : 'CoinGecko · quote pending',
    updatedAt: undefined,
    importedFrom: 'screenshot',
    importProfileId,
    importedAt: Date.now(),
    color: COLORS[colorIndex % COLORS.length],
  });
}

function matchesScreenshotHolding(holding: Holding, incoming: Holding) {
  if ((holding.positionType ?? 'spot') !== (incoming.positionType ?? 'spot'))
    return false;
  if (
    (holding.instrumentType ?? 'crypto') !==
    (incoming.instrumentType ?? 'crypto')
  )
    return false;
  if (
    inferPlatform(holding).toLowerCase() !==
    inferPlatform(incoming).toLowerCase()
  )
    return false;
  if (holding.symbol.toUpperCase() !== incoming.symbol.toUpperCase())
    return false;
  if (incoming.positionType === 'perp')
    return (holding.side ?? 'long') === (incoming.side ?? 'long');
  if (holding.coinId && incoming.coinId)
    return holding.coinId === incoming.coinId;
  if (holding.instrumentType === 'stock')
    return (
      (holding.marketRef ?? holding.symbol).toUpperCase() ===
      (incoming.marketRef ?? incoming.symbol).toUpperCase()
    );
  return (holding.assetClass ?? 'spot') === (incoming.assetClass ?? 'spot');
}

function mergeScreenshotHolding(
  holding: Holding,
  incoming: Holding,
  importProfileId: string,
): Holding {
  const amount = holding.amount + incoming.amount;
  const existingContributions = holding.importContributions?.length
    ? [...holding.importContributions]
    : holding.importProfileId
      ? [
          {
            profileId: holding.importProfileId,
            amount: holding.amount,
            importedAt: holding.importedAt,
          },
        ]
      : [];
  const importContributions = [
    ...existingContributions,
    {
      profileId: importProfileId,
      amount: incoming.amount,
      importedAt: incoming.importedAt,
    },
  ];
  const perp = (holding.positionType ?? 'spot') === 'perp';
  const holdingEntry = Number(holding.entryPrice);
  const incomingEntry = Number(incoming.entryPrice);
  const entryPrice =
    perp && holdingEntry > 0 && incomingEntry > 0
      ? (holding.amount * holdingEntry + incoming.amount * incomingEntry) /
        amount
      : (incoming.entryPrice ?? holding.entryPrice);
  const marginCollateral = perp
    ? Number(holding.marginCollateral ?? 0) +
      Number(incoming.marginCollateral ?? 0)
    : undefined;
  return normalizeHolding({
    ...holding,
    name: incoming.name,
    symbol: incoming.symbol,
    amount,
    source: incoming.source,
    coinId: incoming.coinId ?? holding.coinId,
    network: incoming.network ?? holding.network,
    marketRef: incoming.marketRef ?? holding.marketRef,
    instrumentType: incoming.instrumentType,
    manualPrice: undefined,
    costBasis: undefined,
    entryPrice,
    marginCollateral,
    leverage:
      perp && marginCollateral && entryPrice
        ? (amount * entryPrice) / marginCollateral
        : incoming.leverage,
    provider: incoming.provider,
    importedFrom: holding.importedFrom ?? 'screenshot',
    importProfileId: undefined,
    importContributions,
    accountLabel: 'Combined position · screenshot import',
    importedAt: Date.now(),
  });
}

function parseStoredImportProfiles(raw: string | null) {
  if (!raw) return [];
  try {
    return parseImportProfiles(JSON.parse(raw));
  } catch {
    return [];
  }
}

function normalizeMinimumValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.min(number, 1_000_000)
    : 10;
}

function mergeVenueHistories(
  currentValue: unknown,
  incomingValue: unknown,
  profiles: ImportProfile[],
) {
  const validProfileIds = new Set(profiles.map((profile) => profile.id));
  const byProfile = new Map<string, VenueHistorySeries>();
  for (const history of [
    ...parseVenueHistories(currentValue),
    ...parseVenueHistories(incomingValue),
  ]) {
    if (validProfileIds.has(history.profileId))
      byProfile.set(history.profileId, history);
  }
  return Array.from(byProfile.values());
}

export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (!context)
    throw new Error('usePortfolio must be used inside PortfolioProvider');
  return context;
}

function portfolioWithRebasedHoldings(
  current: StoredPortfolio,
  nextHoldings: Holding[],
): StoredPortfolio {
  const previousValue = calculateAnalytics(
    current.holdings,
    current.minimumPositionValue,
  ).totalValue;
  const nextValue = calculateAnalytics(
    nextHoldings,
    current.minimumPositionValue,
  ).totalValue;
  return {
    ...current,
    holdings: nextHoldings,
    snapshots: rebasePortfolioSnapshots(
      current.snapshots,
      nextValue - previousValue,
    ),
  };
}

function candidateToHolding(
  candidate: WalletImportCandidate,
  source: WalletImportSource,
  address: string,
  importProfileId: string,
  colorIndex: number,
): Holding {
  return {
    id: crypto.randomUUID(),
    name: candidate.name,
    symbol: candidate.symbol,
    amount: candidate.amount,
    source: candidate.priceSource,
    coinId: candidate.coinId,
    network: candidate.network,
    address: candidate.address,
    manualPrice:
      candidate.priceSource === 'manual' ? (candidate.price ?? 0) : undefined,
    costBasis: candidate.costBasis,
    positionType: candidate.positionType,
    assetClass:
      candidate.positionType === 'perp'
        ? undefined
        : (candidate.assetClass ?? 'spot'),
    platform: candidate.platform,
    accountLabel: candidate.accountLabel,
    side: candidate.side,
    leverage: candidate.leverage,
    entryPrice: candidate.entryPrice,
    marginMode: candidate.marginMode,
    marginCollateral: candidate.marginCollateral,
    collateralEligible: candidate.collateralEligible,
    equityOverride: candidate.equityOverride,
    equityMarkPrice: candidate.equityMarkPrice,
    roeBasis: candidate.roeBasis,
    reportedRoe: candidate.reportedRoe,
    reportedUnrealizedPnl: candidate.reportedUnrealizedPnl,
    stakingPrincipalAmount: candidate.stakingPrincipalAmount,
    stakingRewardsAmount: candidate.stakingRewardsAmount,
    stakingRewardsSource: candidate.stakingRewardsSource,
    liquidationModel: candidate.liquidationModel,
    maintenanceMarginRate: candidate.maintenanceMarginRate,
    reportedLiquidationPrice: candidate.reportedLiquidationPrice,
    price: candidate.price,
    change24h: candidate.change24h ?? null,
    marketCap: candidate.marketCap ?? null,
    volume24h: candidate.volume24h ?? null,
    liquidity: candidate.liquidity ?? null,
    provider: candidate.provider,
    updatedAt: Date.now(),
    importedFrom: source,
    importProfileId,
    walletAddress: address,
    walletSnapshotAmount: candidate.amount,
    importedAt: Date.now(),
    marketRef: candidate.marketRef,
    accountMode: candidate.accountMode,
    color: COLORS[colorIndex % COLORS.length],
  };
}

function replaceWalletProfileSnapshot(
  holdings: Holding[],
  candidates: WalletImportCandidate[],
  source: WalletImportSource,
  address: string,
  importProfileId: string,
  warnings: string[] = [],
) {
  const existing = holdings.filter(
    (holding) => holding.importProfileId === importProfileId,
  );
  const incompleteKinds = incompleteWalletSnapshotKinds(source, warnings);
  const matchedIds = new Set<string>();
  const refreshed = candidates.flatMap((candidate, index) => {
    const match = existing.find(
      (holding) =>
        !matchedIds.has(holding.id) &&
        matchesImport(holding, candidate, importProfileId),
    );
    const next = candidateToHolding(
      candidate,
      source,
      address,
      importProfileId,
      holdings.length + index,
    );
    if (!match) return [next];
    matchedIds.add(match.id);
    if (incompleteKinds.has(walletSnapshotKind(next))) return [match];
    const manualDelta = localWalletQuantityDelta(match);
    const amount = Math.max(0, candidate.amount + manualDelta);
    if (!(amount > 0)) return [];
    return [
      {
        ...next,
        id: match.id,
        amount,
        color: match.color,
        price: next.price ?? match.price,
        manualPrice: next.manualPrice ?? match.manualPrice,
        change24h: next.change24h ?? match.change24h,
        marketCap: next.marketCap ?? match.marketCap,
        volume24h: next.volume24h ?? match.volume24h,
        liquidity: next.liquidity ?? match.liquidity,
        updatedAt: next.price != null ? next.updatedAt : match.updatedAt,
        costBasis: next.costBasis ?? match.costBasis,
        targetPrice: match.targetPrice,
        stopLossPrice: match.stopLossPrice,
      },
    ];
  });
  const preservedIncomplete = existing.filter(
    (holding) =>
      !matchedIds.has(holding.id) &&
      incompleteKinds.has(walletSnapshotKind(holding)),
  );
  const preservedIds = new Set(
    preservedIncomplete.map((holding) => holding.id),
  );
  const retainedManualDeltas = existing.flatMap((holding) => {
    if (matchedIds.has(holding.id)) return [];
    if (preservedIds.has(holding.id)) return [];
    // A venue-confirmed closed perpetual is no longer open, even when its
    // locally edited quantity previously differed from the last snapshot.
    if (holding.positionType === 'perp') return [];
    const amount = localWalletQuantityDelta(holding);
    if (!(amount > 0)) return [];
    return [
      normalizeHolding({
        ...holding,
        amount,
        walletSnapshotAmount: 0,
        equityOverride: undefined,
        equityMarkPrice: undefined,
        reportedRoe: undefined,
        reportedUnrealizedPnl: undefined,
        liquidationModel: undefined,
        reportedLiquidationPrice: undefined,
      }),
    ];
  });
  return [
    ...holdings.filter(
      (holding) => holding.importProfileId !== importProfileId,
    ),
    ...refreshed,
    ...preservedIncomplete,
    ...retainedManualDeltas,
  ];
}

type WalletSnapshotKind = 'perp' | 'spot' | 'staking';

function walletSnapshotKind(holding: Holding): WalletSnapshotKind {
  if (holding.positionType === 'perp') return 'perp';
  if (
    holding.assetClass === 'staked' ||
    holding.assetClass === 'staking' ||
    holding.assetClass === 'unstaking'
  )
    return 'staking';
  return 'spot';
}

function incompleteWalletSnapshotKinds(
  source: WalletImportSource,
  warnings: string[] = [],
) {
  const kinds = new Set<WalletSnapshotKind>();
  const normalized = warnings.join(' ').toLowerCase();
  if (
    normalized.includes('staking metadata was unavailable') ||
    normalized.includes('staked hype balances could not be read')
  )
    kinds.add('staking');
  if (source === 'hyperliquid') {
    if (normalized.includes('perpetual positions could not be read'))
      kinds.add('perp');
    if (normalized.includes('spot balances could not be read'))
      kinds.add('spot');
  }
  if (
    source === 'lighter' &&
    normalized.includes('perpetual positions could not be read')
  )
    kinds.add('perp');
  return kinds;
}

function matchesImport(
  holding: Holding,
  candidate: WalletImportCandidate,
  importProfileId: string,
) {
  if (holding.importProfileId !== importProfileId) return false;
  if ((holding.positionType ?? 'spot') !== candidate.positionType) return false;
  if (
    inferPlatform(holding).toLowerCase() !==
    candidate.platform.trim().toLowerCase()
  )
    return false;
  if (candidate.positionType === 'perp') {
    if (
      holding.symbol.toUpperCase() !== candidate.symbol.toUpperCase() ||
      (holding.side ?? 'long') !== (candidate.side ?? 'long')
    )
      return false;
    if (candidate.accountLabel && holding.importedFrom === 'lighter') {
      return holding.accountLabel
        ? holding.accountLabel === candidate.accountLabel
        : holding.network === candidate.network;
    }
    return true;
  }
  if ((holding.assetClass ?? 'spot') !== (candidate.assetClass ?? 'spot'))
    return false;
  if (holding.coinId && candidate.coinId && holding.coinId === candidate.coinId)
    return true;
  if (
    holding.address &&
    candidate.address &&
    holding.address.toLowerCase() === candidate.address.toLowerCase()
  )
    return true;
  return holding.symbol.toUpperCase() === candidate.symbol.toUpperCase();
}

function mergeImportedHolding(
  holding: Holding,
  candidate: WalletImportCandidate,
  source: WalletImportSource,
  address: string,
  importProfileId: string,
): Holding {
  const amount = holding.amount + candidate.amount;
  const perp = (holding.positionType ?? 'spot') === 'perp';
  const currentEntry = Number(holding.entryPrice ?? holding.price ?? 0);
  const importedEntry = Number(
    candidate.entryPrice ?? candidate.price ?? currentEntry,
  );
  const entryPrice =
    perp && currentEntry > 0 && importedEntry > 0
      ? (holding.amount * currentEntry + candidate.amount * importedEntry) /
        amount
      : holding.entryPrice;
  const marginCollateral = perp
    ? Number(
        holding.marginCollateral ??
          (holding.amount * currentEntry) / Number(holding.leverage ?? 1),
      ) +
      Number(
        candidate.marginCollateral ??
          (candidate.amount * importedEntry) / Number(candidate.leverage ?? 1),
      )
    : holding.marginCollateral;
  const leverage =
    perp && marginCollateral && entryPrice
      ? Math.max(1, (amount * entryPrice) / marginCollateral)
      : holding.leverage;
  const currentEquity = Number(holding.equityOverride);
  const importedEquity = Number(candidate.equityOverride);
  const equityOverride =
    perp && (Number.isFinite(currentEquity) || Number.isFinite(importedEquity))
      ? Math.max(0, Number.isFinite(currentEquity) ? currentEquity : 0) +
        Math.max(0, Number.isFinite(importedEquity) ? importedEquity : 0)
      : holding.equityOverride;
  const equityMarkPrice =
    perp && holding.equityMarkPrice != null && candidate.equityMarkPrice != null
      ? (holding.amount * holding.equityMarkPrice +
          candidate.amount * candidate.equityMarkPrice) /
        amount
      : (candidate.equityMarkPrice ?? holding.equityMarkPrice);
  const roeBasis =
    perp && (holding.roeBasis != null || candidate.roeBasis != null)
      ? Math.max(0, Number(holding.roeBasis ?? 0)) +
        Math.max(0, Number(candidate.roeBasis ?? 0))
      : holding.roeBasis;
  const currentRoeWeight = Math.max(0, Number(holding.marginCollateral ?? 0));
  const importedRoeWeight = Math.max(
    0,
    Number(candidate.marginCollateral ?? 0),
  );
  const reportedRoe =
    perp &&
    Number.isFinite(holding.reportedRoe) &&
    Number.isFinite(candidate.reportedRoe) &&
    currentRoeWeight + importedRoeWeight > 0
      ? (Number(holding.reportedRoe) * currentRoeWeight +
          Number(candidate.reportedRoe) * importedRoeWeight) /
        (currentRoeWeight + importedRoeWeight)
      : (candidate.reportedRoe ?? holding.reportedRoe);
  const currentReportedPnl = Number(holding.reportedUnrealizedPnl);
  const importedReportedPnl = Number(candidate.reportedUnrealizedPnl);
  const reportedUnrealizedPnl =
    perp &&
    (Number.isFinite(currentReportedPnl) ||
      Number.isFinite(importedReportedPnl))
      ? (Number.isFinite(currentReportedPnl) ? currentReportedPnl : 0) +
        (Number.isFinite(importedReportedPnl) ? importedReportedPnl : 0)
      : holding.reportedUnrealizedPnl;
  const costBasis =
    !perp && holding.costBasis != null && candidate.costBasis != null
      ? (holding.amount * holding.costBasis +
          candidate.amount * candidate.costBasis) /
        amount
      : undefined;
  const stakingPrincipalAmount = sumImportedMetric(
    holding.stakingPrincipalAmount,
    candidate.stakingPrincipalAmount,
  );
  const stakingRewardsAmount = sumImportedMetric(
    holding.stakingRewardsAmount,
    candidate.stakingRewardsAmount,
  );
  return {
    ...holding,
    amount,
    costBasis,
    entryPrice,
    marginCollateral,
    collateralEligible:
      candidate.collateralEligible ?? holding.collateralEligible,
    leverage,
    equityOverride,
    equityMarkPrice,
    roeBasis,
    reportedRoe,
    reportedUnrealizedPnl,
    stakingPrincipalAmount,
    stakingRewardsAmount,
    stakingRewardsSource:
      candidate.stakingRewardsSource ?? holding.stakingRewardsSource,
    liquidationModel: candidate.liquidationModel ?? holding.liquidationModel,
    reportedLiquidationPrice: perp
      ? undefined
      : holding.reportedLiquidationPrice,
    assetClass: perp
      ? undefined
      : (candidate.assetClass ?? holding.assetClass ?? 'spot'),
    platform: candidate.platform,
    accountLabel: candidate.accountLabel ?? holding.accountLabel,
    source: candidate.priceSource,
    manualPrice:
      candidate.priceSource === 'manual'
        ? (candidate.price ?? holding.manualPrice)
        : undefined,
    price: candidate.price ?? holding.price,
    change24h: candidate.change24h ?? holding.change24h,
    marketCap: candidate.marketCap ?? holding.marketCap,
    volume24h: candidate.volume24h ?? holding.volume24h,
    liquidity: candidate.liquidity ?? holding.liquidity,
    provider: candidate.provider,
    updatedAt: Date.now(),
    importedFrom: source,
    importProfileId,
    walletAddress: address,
    importedAt: Date.now(),
    marketRef: candidate.marketRef ?? holding.marketRef,
    accountMode: candidate.accountMode ?? holding.accountMode,
  };
}

function sumImportedMetric(
  current: number | undefined,
  incoming: number | undefined,
) {
  const hasCurrent = Number.isFinite(current);
  const hasIncoming = Number.isFinite(incoming);
  if (!hasCurrent && !hasIncoming) return undefined;
  return (
    Math.max(0, hasCurrent ? Number(current) : 0) +
    Math.max(0, hasIncoming ? Number(incoming) : 0)
  );
}

function sourceName(source: WalletImportSource) {
  if (source === 'hyperliquid') return 'Hyperliquid';
  if (source === 'lighter') return 'Lighter';
  return 'Onchain';
}

function reconcileImportContributions(holding: Holding): Holding {
  if (!holding.importContributions?.length) return holding;
  const contributed = holding.importContributions.reduce(
    (sum, item) => sum + item.amount,
    0,
  );
  if (!(contributed > holding.amount) || !(holding.amount > 0)) return holding;
  const ratio = holding.amount / contributed;
  return {
    ...holding,
    importContributions: holding.importContributions.map((item) => ({
      ...item,
      amount: item.amount * ratio,
    })),
  };
}
