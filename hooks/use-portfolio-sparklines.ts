'use client';

import { useEffect, useMemo, useState } from 'react';

import type { PortfolioAnalytics } from '@/lib/analytics';
import type { SparklineSeries } from '@/lib/sparklines';

const DAILY_PNL_STABLECOINS = new Set([
  'USDC',
  'USDT',
  'DAI',
  'USDE',
  'USDS',
  'PYUSD',
  'FDUSD',
  'TUSD',
]);

type SparklineAsset = {
  key: string;
  symbol: string;
  instrumentType: 'crypto' | 'stock';
  coinId?: string;
  marketRef?: string;
  currentPrice?: number;
  color: string;
};

type SparklineCacheEntry = {
  data?: Record<string, SparklineSeries>;
  request?: Promise<Record<string, SparklineSeries>>;
};

const sparklineCache = new Map<string, SparklineCacheEntry>();

export function usePortfolioSparklines(analytics: PortfolioAnalytics) {
  const [utcDayKey, setUtcDayKey] = useState(() => utcCalendarDay(Date.now()));
  const sparklineAssetData = useMemo(() => {
    const assets = new Map<string, (typeof analytics.assetData)[number]>();
    for (const asset of analytics.assetData.slice(0, 5))
      assets.set(asset.key, asset);
    for (const asset of analytics.assetData) {
      if (asset.instrumentType === 'crypto') assets.set(asset.key, asset);
      if (assets.size >= 40) break;
    }
    return Array.from(assets.values()).slice(0, 40);
  }, [analytics.assetData]);
  const sparklineAssets = useMemo<SparklineAsset[]>(
    () =>
      sparklineAssetData.map((asset) => {
        const matchingHoldings = analytics.holdings.filter(
          (holding) =>
            holding.symbol.toUpperCase() === asset.symbol &&
            (holding.instrumentType === 'stock' ? 'stock' : 'crypto') ===
              asset.instrumentType,
        );
        const identified = matchingHoldings.find((holding) => holding.coinId);
        const marketLinked = matchingHoldings.find(
          (holding) => holding.marketRef,
        );
        const priced = matchingHoldings.find(
          (holding) => Number(holding.price ?? holding.manualPrice) > 0,
        );
        return {
          key: asset.key,
          symbol: asset.symbol,
          instrumentType: asset.instrumentType,
          coinId: identified?.coinId,
          marketRef: marketLinked?.marketRef,
          currentPrice: priced?.price ?? priced?.manualPrice,
          color: asset.color,
        };
      }),
    [analytics.holdings, sparklineAssetData],
  );
  const sparklineRequestKey = JSON.stringify(sparklineAssets);
  const cacheKey = `${utcDayKey}:${sparklineRequestKey}`;
  const [sparklines, setSparklines] = useState<Record<string, SparklineSeries>>(
    () => sparklineCache.get(cacheKey)?.data ?? {},
  );

  useEffect(() => {
    const timer = window.setInterval(
      () => setUtcDayKey(utcCalendarDay(Date.now())),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!sparklineAssets.length) {
      const timer = window.setTimeout(() => setSparklines({}), 0);
      return () => window.clearTimeout(timer);
    }

    let active = true;
    const cached = sparklineCache.get(cacheKey);
    if (cached?.data) {
      const timer = window.setTimeout(() => {
        if (active) setSparklines(cached.data ?? {});
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }

    const request =
      cached?.request ??
      fetch('/api/market/sparklines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assets: sparklineAssets }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error('Sparkline history failed');
          const result = (await response.json()) as {
            sparklines?: Record<string, SparklineSeries>;
          };
          return result.sparklines ?? {};
        })
        .then((data) => {
          sparklineCache.set(cacheKey, { data });
          return data;
        })
        .catch(() => {
          sparklineCache.delete(cacheKey);
          return {};
        });

    sparklineCache.set(cacheKey, { request });
    void request.then((data) => {
      if (active) setSparklines(data);
    });
    return () => {
      active = false;
    };
  }, [cacheKey, sparklineAssets]);

  const dailyCoinPnl = useMemo(() => {
    const rows = sparklineAssets.flatMap((asset) => {
      if (
        asset.instrumentType !== 'crypto' ||
        DAILY_PNL_STABLECOINS.has(asset.symbol.toUpperCase())
      )
        return [];
      const series = sparklines[asset.key];
      const dayOpen = Number(series?.utcDayOpen);
      const canonicalPrice = Number(series?.points.at(-1));
      if (!(dayOpen > 0) || !(canonicalPrice > 0)) return [];
      const matching = analytics.holdings.filter(
        (holding) =>
          holding.instrumentType !== 'stock' &&
          holding.symbol.toUpperCase() === asset.symbol.toUpperCase(),
      );
      const pnl = matching.reduce((sum, holding) => {
        const direction =
          holding.positionKind === 'perp' && holding.side === 'short' ? -1 : 1;
        return sum + direction * holding.amount * (canonicalPrice - dayOpen);
      }, 0);
      return [
        {
          key: asset.key,
          symbol: asset.symbol,
          pnl,
          positive: Math.max(0, pnl),
          negative: Math.min(0, pnl),
          dayOpen,
          latestPrice: canonicalPrice,
          changePercent: (canonicalPrice / dayOpen - 1) * 100,
          positionCount: matching.length,
          color: asset.color,
        },
      ];
    });
    const visible = [...rows]
      .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl))
      .slice(0, 10)
      .sort((left, right) => right.pnl - left.pnl);
    return {
      rows: visible,
      total: rows.reduce((sum, row) => sum + row.pnl, 0),
      coverage: rows.length,
      requested: sparklineAssets.filter(
        (asset) =>
          asset.instrumentType === 'crypto' &&
          !DAILY_PNL_STABLECOINS.has(asset.symbol.toUpperCase()),
      ).length,
    };
  }, [analytics.holdings, sparklines, sparklineAssets]);

  return { dailyCoinPnl, sparklines, sparklineAssets };
}

export function resolveCurrentUtcPnl({
  dailyCoinPnl,
  venueTodayPnl,
  portfolioValue,
}: {
  dailyCoinPnl: { total: number; coverage: number; requested: number };
  venueTodayPnl: number;
  portfolioValue: number;
}) {
  const maxPlausibleDailyPnl = Math.max(10_000, portfolioValue * 3);
  const safeVenueTodayPnl =
    Math.abs(venueTodayPnl) <= maxPlausibleDailyPnl ? venueTodayPnl : 0;
  const hasCompleteCoinCoverage =
    dailyCoinPnl.coverage > 0 &&
    dailyCoinPnl.coverage === dailyCoinPnl.requested &&
    Math.abs(dailyCoinPnl.total) <= maxPlausibleDailyPnl;
  return hasCompleteCoinCoverage ? dailyCoinPnl.total : safeVenueTodayPnl;
}

function utcCalendarDay(timestamp: number) {
  const date = new Date(timestamp);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}
