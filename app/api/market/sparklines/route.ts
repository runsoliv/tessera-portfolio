import {
  normalizeSparkline,
  sparklineChangePercent,
  type SparklineSeries,
} from '@/lib/sparklines';

type IncomingAsset = {
  key: string;
  symbol: string;
  instrumentType: 'crypto' | 'stock';
  coinId?: string;
  marketRef?: string;
};

type CoinGeckoMarket = {
  id?: string;
  symbol?: string;
  price_change_percentage_7d_in_currency?: number | null;
  sparkline_in_7d?: { price?: unknown[] };
};

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      indicators?: { quote?: Array<{ close?: Array<number | null> }> };
    }>;
  };
};

export async function POST(request: Request) {
  let assets: IncomingAsset[];
  try {
    const body = (await request.json()) as { assets?: IncomingAsset[] };
    assets = Array.isArray(body.assets)
      ? body.assets.slice(0, 12).filter(isValidAsset)
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
    const coinId = cleanCoinId(asset.coinId);
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

  const stockWarnings = await mapWithConcurrency(
    assets.filter((asset) => asset.instrumentType === 'stock'),
    4,
    async (asset) => {
      const ticker = cleanTicker(asset.marketRef ?? asset.symbol);
      if (!ticker) return null;
      try {
        const response = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=30m&range=5d`,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent':
                'Mozilla/5.0 (compatible; Tessera-Local-Portfolio/1.0)',
            },
            signal: AbortSignal.timeout(8_000),
          },
        );
        if (!response.ok)
          throw new Error(`Stock history returned ${response.status}`);
        const data = (await response.json()) as YahooChartResponse;
        const points = normalizeSparkline(
          data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [],
        );
        if (points.length < 2) return null;
        sparklines[asset.key] = {
          points,
          changePercent: sparklineChangePercent(points),
          provider: 'Yahoo Finance',
          range: '5D',
        };
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
  const points = normalizeSparkline(market.sparkline_in_7d?.price ?? []);
  if (points.length < 2) return null;
  const reportedChange = Number(market.price_change_percentage_7d_in_currency);
  return {
    points,
    changePercent: Number.isFinite(reportedChange)
      ? reportedChange
      : sparklineChangePercent(points),
    provider: 'CoinGecko',
    range: '7D' as const,
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

function cleanCoinId(value?: string) {
  const cleaned = value?.trim().toLowerCase();
  return cleaned && /^[a-z0-9-]{1,100}$/.test(cleaned) ? cleaned : null;
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
