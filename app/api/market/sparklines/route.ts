import {
  normalizeSparkline,
  sparklineChangePercent,
  type SparklineSeries,
  utcDayOpenFromUniformSeries,
} from '@/lib/sparklines';
import { CURATED_ASSETS } from '@/lib/portfolio';

type IncomingAsset = {
  key: string;
  symbol: string;
  instrumentType: 'crypto' | 'stock';
  coinId?: string;
  marketRef?: string;
  currentPrice?: number;
};

type CoinGeckoMarket = {
  id?: string;
  symbol?: string;
  price_change_percentage_7d_in_currency?: number | null;
  sparkline_in_7d?: { price?: unknown[] };
  last_updated?: string;
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
};

type DefiLlamaChartResponse = {
  coins?: Record<
    string,
    {
      symbol?: string;
      confidence?: number;
      prices?: Array<{ timestamp?: number; price?: number }>;
    }
  >;
};

export async function POST(request: Request) {
  let assets: IncomingAsset[];
  try {
    const body = (await request.json()) as { assets?: IncomingAsset[] };
    assets = Array.isArray(body.assets)
      ? body.assets.slice(0, 40).filter(isValidAsset)
      : [];
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const sparklines: Record<string, SparklineSeries> = {};
  const warnings: string[] = [];
  const cryptoAssets = assets.filter(
    (asset) => asset.instrumentType === 'crypto',
  );

  const cryptoById = new Map<string, IncomingAsset[]>();
  for (const asset of cryptoAssets) {
    const coinId = resolvedCoinId(asset);
    if (coinId)
      cryptoById.set(coinId, [...(cryptoById.get(coinId) ?? []), asset]);
  }

  if (cryptoById.size) {
    try {
      const markets = await fetchCoinGeckoMarkets({
        ids: Array.from(cryptoById.keys()).join(','),
      });
      for (const market of markets) {
        const matches = market.id ? cryptoById.get(market.id) : undefined;
        if (!matches) continue;
        for (const asset of matches) {
          const series = coinGeckoSeries(market);
          if (series) sparklines[asset.key] = series;
        }
      }
    } catch (error) {
      warnings.push(
        messageFrom(error, 'CoinGecko chart history is unavailable'),
      );
    }
  }

  const unresolvedCrypto = cryptoAssets.filter(
    (asset) => !sparklines[asset.key],
  );
  const cryptoBySymbol = new Map<string, IncomingAsset[]>();
  for (const asset of unresolvedCrypto) {
    const symbol = cleanSymbol(asset.symbol);
    if (symbol)
      cryptoBySymbol.set(symbol, [
        ...(cryptoBySymbol.get(symbol) ?? []),
        asset,
      ]);
  }

  if (cryptoBySymbol.size) {
    try {
      const markets = await fetchCoinGeckoMarkets({
        symbols: Array.from(cryptoBySymbol.keys()).join(','),
        include_tokens: 'top',
      });
      for (const market of markets) {
        const symbol = cleanSymbol(market.symbol);
        const matches = symbol ? cryptoBySymbol.get(symbol) : undefined;
        if (!matches) continue;
        for (const asset of matches) {
          const series = coinGeckoSeries(market);
          if (series) sparklines[asset.key] = series;
        }
      }
    } catch (error) {
      warnings.push(messageFrom(error, 'Crypto chart fallback is unavailable'));
    }
  }

  const unresolvedWithCoinId = cryptoAssets.filter(
    (asset) => !sparklines[asset.key] && resolvedCoinId(asset),
  );
  if (unresolvedWithCoinId.length) {
    try {
      const keys = Array.from(
        new Set(
          unresolvedWithCoinId.map(
            (asset) => `coingecko:${resolvedCoinId(asset)}`,
          ),
        ),
      );
      const llamaSeries = await fetchDefiLlamaSeries(keys);
      for (const asset of unresolvedWithCoinId) {
        const key = `coingecko:${resolvedCoinId(asset)}`;
        const series = llamaSeries.get(key);
        if (series) sparklines[asset.key] = series;
      }
    } catch (error) {
      warnings.push(messageFrom(error, 'DefiLlama chart fallback is unavailable'));
    }
  }

  const unresolvedAfterCoinGecko = cryptoAssets.filter(
    (asset) => !sparklines[asset.key],
  );
  await mapWithConcurrency(unresolvedAfterCoinGecko, 4, async (asset) => {
    const symbol = cleanSymbol(asset.symbol)?.toUpperCase();
    if (!symbol) return null;
    try {
      const series = await fetchYahooSeries(`${symbol}-USD`, asset.currentPrice);
      if (series) sparklines[asset.key] = series;
    } catch {
      // Some crypto tickers are not listed by Yahoo. The primary CoinGecko
      // result remains authoritative when it is available.
    }
    return null;
  });

  const stockWarnings = await mapWithConcurrency(
    assets.filter((asset) => asset.instrumentType === 'stock'),
    4,
    async (asset) => {
      const ticker = cleanTicker(asset.marketRef ?? asset.symbol);
      if (!ticker) return null;
      try {
        const series = await fetchYahooSeries(ticker);
        if (series) sparklines[asset.key] = series;
        return null;
      } catch (error) {
        return messageFrom(error, `${ticker} chart history is unavailable`);
      }
    },
  );
  warnings.push(
    ...stockWarnings.filter((warning): warning is string => warning != null),
  );

  return Response.json({ sparklines, warnings });
}

async function fetchCoinGeckoMarkets(filters: Record<string, string>) {
  const params = new URLSearchParams({
    vs_currency: 'usd',
    sparkline: 'true',
    price_change_percentage: '7d',
    ...filters,
  });
  const response = await fetch(
    `https://api.coingecko.com/api/v3/coins/markets?${params}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Tessera-Local-Portfolio/1.0',
      },
      signal: AbortSignal.timeout(9_000),
    },
  );
  if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as CoinGeckoMarket[]) : [];
}

function coinGeckoSeries(market: CoinGeckoMarket) {
  const rawPoints = market.sparkline_in_7d?.price ?? [];
  const points = normalizeSparkline(rawPoints);
  if (points.length < 2) return null;
  const reportedChange = Number(market.price_change_percentage_7d_in_currency);
  const reportedTimestamp = Date.parse(market.last_updated ?? '');
  const endTimestamp = Number.isFinite(reportedTimestamp)
    ? reportedTimestamp
    : Date.now();
  const utcDayOpen = utcDayOpenFromUniformSeries(
    rawPoints,
    endTimestamp,
    7,
  );
  const latest = Number(
    rawPoints
      .map(Number)
      .filter((value) => Number.isFinite(value) && value > 0)
      .at(-1),
  );
  return {
    points,
    changePercent: Number.isFinite(reportedChange)
      ? reportedChange
      : sparklineChangePercent(points),
    provider: 'CoinGecko',
    range: '7D' as const,
    utcDayOpen: utcDayOpen?.price,
    utcDayStart: utcDayOpen?.timestamp,
    utcDayChangePercent:
      utcDayOpen && Number.isFinite(latest)
        ? (latest / utcDayOpen.price - 1) * 100
        : null,
  };
}

function isValidAsset(value: IncomingAsset) {
  return (
    value &&
    typeof value.key === 'string' &&
    value.key.length <= 100 &&
    typeof value.symbol === 'string' &&
    value.symbol.length <= 30 &&
    (value.instrumentType === 'crypto' || value.instrumentType === 'stock')
  );
}

async function fetchYahooSeries(ticker: string, expectedPrice?: number) {
  const response = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1h&range=5d`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Tessera-Local-Portfolio/1.0)',
      },
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok)
    throw new Error(`Yahoo history returned ${response.status}`);
  const data = (await response.json()) as YahooChartResponse;
  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];
  const points = normalizeSparkline(quote?.close ?? []);
  if (points.length < 2 || !timestamps.length) return null;
  const latest = points.at(-1);
  if (
    expectedPrice &&
    latest &&
    Math.abs(latest / expectedPrice - 1) > 0.5
  )
    return null;
  const now = Date.now();
  const date = new Date(now);
  const utcDayStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const dayIndex = timestamps.findIndex(
    (timestamp) => timestamp * 1_000 >= utcDayStart,
  );
  const utcDayOpen = Number(
    dayIndex >= 0
      ? (quote?.open?.[dayIndex] ?? quote?.close?.[dayIndex])
      : undefined,
  );
  return {
    points,
    changePercent: sparklineChangePercent(points),
    provider: 'Yahoo Finance',
    range: '5D' as const,
    utcDayOpen: utcDayOpen > 0 ? utcDayOpen : undefined,
    utcDayStart: utcDayOpen > 0 ? utcDayStart : undefined,
    utcDayChangePercent:
      utcDayOpen > 0 && latest ? (latest / utcDayOpen - 1) * 100 : null,
  };
}

async function fetchDefiLlamaSeries(keys: string[]) {
  const now = Date.now();
  const start = Math.floor((now - 5 * 86_400_000) / 1_000);
  const params = new URLSearchParams({
    start: String(start),
    span: '120',
    period: '1h',
  });
  const response = await fetch(
    `https://coins.llama.fi/chart/${encodeURIComponent(keys.join(','))}?${params}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Tessera-Local-Portfolio/1.0',
      },
      signal: AbortSignal.timeout(9_000),
    },
  );
  if (!response.ok)
    throw new Error(`DefiLlama returned ${response.status}`);
  const data = (await response.json()) as DefiLlamaChartResponse;
  const date = new Date(now);
  const utcDayStart = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  const series = new Map<string, SparklineSeries>();
  for (const key of keys) {
    const samples = (data.coins?.[key]?.prices ?? [])
      .map((point) => ({
        timestamp: Number(point.timestamp) * 1_000,
        price: Number(point.price),
      }))
      .filter(
        (point) =>
          Number.isFinite(point.timestamp) &&
          Number.isFinite(point.price) &&
          point.price > 0,
      )
      .sort((left, right) => left.timestamp - right.timestamp);
    if (samples.length < 2) continue;
    const nearestOpen = [...samples].sort(
      (left, right) =>
        Math.abs(left.timestamp - utcDayStart) -
        Math.abs(right.timestamp - utcDayStart),
    )[0];
    const points = normalizeSparkline(samples.map((point) => point.price));
    const latest = samples.at(-1)?.price;
    series.set(key, {
      points,
      changePercent: sparklineChangePercent(points),
      provider: 'DefiLlama',
      range: '5D',
      utcDayOpen: nearestOpen?.price,
      utcDayStart,
      utcDayChangePercent:
        nearestOpen?.price && latest
          ? (latest / nearestOpen.price - 1) * 100
          : null,
    });
  }
  return series;
}

function cleanCoinId(value?: string) {
  const cleaned = value?.trim().toLowerCase();
  return cleaned && /^[a-z0-9-]{1,100}$/.test(cleaned) ? cleaned : null;
}

function resolvedCoinId(asset: IncomingAsset) {
  const explicit = cleanCoinId(asset.coinId);
  if (explicit) return explicit;
  const symbol = cleanSymbol(asset.symbol)?.toUpperCase();
  if (!symbol) return null;
  const aliases: Record<string, string> = {
    BTC: 'bitcoin',
    WBTC: 'bitcoin',
    ETH: 'ethereum',
    WETH: 'ethereum',
    HYPE: 'hyperliquid',
    LIT: 'lighter',
    USDC: 'usd-coin',
    USDT: 'tether',
  };
  return (
    aliases[symbol] ??
    CURATED_ASSETS.find(
      (candidate) => candidate.symbol.toUpperCase() === symbol,
    )?.id ??
    null
  );
}

function cleanSymbol(value?: string) {
  const cleaned = value?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return cleaned?.slice(0, 20) || null;
}

function cleanTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  return /^[A-Z0-9.^=-]{1,20}$/.test(ticker) ? ticker : null;
}

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<R>,
) {
  const results = Array.from({ length: items.length }) as R[];
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const currentIndex = index++;
        results[currentIndex] = await callback(items[currentIndex]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
