import type { Holding, PriceResult } from '@/lib/portfolio';
import { isSuspiciousSpotPriceJump } from '@/lib/price-guard';

type IncomingHolding = Pick<
  Holding,
  | 'id'
  | 'source'
  | 'coinId'
  | 'symbol'
  | 'network'
  | 'address'
  | 'manualPrice'
  | 'price'
  | 'positionType'
  | 'importedFrom'
  | 'marketRef'
  | 'change24h'
  | 'marketCap'
  | 'volume24h'
  | 'liquidity'
  | 'provider'
  | 'updatedAt'
>;

export async function POST(request: Request) {
  let holdings: IncomingHolding[];
  try {
    const payload = (await request.json()) as { holdings?: IncomingHolding[] };
    holdings = Array.isArray(payload.holdings)
      ? payload.holdings.slice(0, 100)
      : [];
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const prices: Record<string, PriceResult> = {};
  const warnings: string[] = [];
  const now = Date.now();

  for (const holding of holdings.filter(
    (item) => item.source === 'manual' && !isVenuePerp(item),
  )) {
    if (
      Number.isFinite(holding.manualPrice) &&
      Number(holding.manualPrice) >= 0
    ) {
      prices[holding.id] = {
        price: Number(holding.manualPrice),
        change24h: finiteOrNull(holding.change24h),
        marketCap: finiteOrNull(holding.marketCap),
        volume24h: finiteOrNull(holding.volume24h),
        liquidity: finiteOrNull(holding.liquidity),
        provider: holding.provider ?? 'Manual',
        updatedAt: holding.updatedAt ?? now,
      };
    }
  }

  const marketHoldings = holdings.filter(
    (item) => item.source === 'coingecko' && item.coinId && !isVenuePerp(item),
  );
  if (marketHoldings.length) {
    const ids = [
      ...new Set(marketHoldings.map((item) => item.coinId as string)),
    ];
    try {
      const params = new URLSearchParams({
        ids: ids.join(','),
        vs_currencies: 'usd',
        include_market_cap: 'true',
        include_24hr_vol: 'true',
        include_24hr_change: 'true',
        include_last_updated_at: 'true',
      });
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?${params}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Tessera-Local-Portfolio/1.0',
          },
          signal: AbortSignal.timeout(9_000),
        },
      );
      if (!response.ok)
        throw new Error(`CoinGecko returned ${response.status}`);
      const data = (await response.json()) as Record<
        string,
        Record<string, number | null>
      >;
      for (const holding of marketHoldings) {
        const quote = data[holding.coinId as string];
        if (quote && Number.isFinite(quote.usd)) {
          prices[holding.id] = {
            price: Number(quote.usd),
            change24h: finiteOrNull(quote.usd_24h_change),
            marketCap: finiteOrNull(quote.usd_market_cap),
            volume24h: finiteOrNull(quote.usd_24h_vol),
            liquidity: null,
            provider: 'CoinGecko',
            updatedAt: Number(quote.last_updated_at) * 1000 || now,
          };
        }
      }
    } catch (error) {
      warnings.push(
        error instanceof Error ? error.message : 'CoinGecko is unavailable',
      );
    }

    const missing = marketHoldings.filter((holding) => !prices[holding.id]);
    await Promise.all(
      missing.map(async (holding) => {
        const symbol = holding.symbol
          .replace(/[^a-zA-Z0-9]/g, '')
          .toUpperCase();
        if (!symbol) return;
        try {
          const response = await fetch(
            `https://api.coinbase.com/v2/exchange-rates?currency=${encodeURIComponent(symbol)}`,
            {
              headers: {
                Accept: 'application/json',
                'User-Agent': 'Tessera-Local-Portfolio/1.0',
              },
              signal: AbortSignal.timeout(7_000),
            },
          );
          if (!response.ok) return;
          const data = (await response.json()) as {
            data?: { rates?: { USD?: string } };
          };
          const price = Number(data.data?.rates?.USD);
          if (Number.isFinite(price) && price > 0)
            prices[holding.id] = marketResult(price, 'Coinbase fallback', now);
        } catch {
          // The client retains its last known quote when both providers are unavailable.
        }
      }),
    );
  }

  const stockHoldings = holdings.filter(
    (holding) => holding.source === 'yahoo',
  );
  if (stockHoldings.length) {
    const byTicker = new Map<string, IncomingHolding[]>();
    for (const holding of stockHoldings) {
      const ticker = cleanStockTicker(holding.marketRef ?? holding.symbol);
      if (ticker)
        byTicker.set(ticker, [...(byTicker.get(ticker) ?? []), holding]);
    }

    const stockWarnings = await mapWithConcurrency(
      Array.from(byTicker),
      6,
      async ([ticker, tickerHoldings]) => {
        try {
          const response = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=5d`,
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
            throw new Error(
              `Yahoo Finance returned ${response.status} for ${ticker}`,
            );
          const data = (await response.json()) as YahooChartResponse;
          const meta = data.chart?.result?.[0]?.meta;
          const price = positiveOrUndefined(meta?.regularMarketPrice);
          if (!price || meta?.currency !== 'USD')
            throw new Error(`No USD quote returned for ${ticker}`);
          const previous = positiveOrUndefined(
            meta.chartPreviousClose ?? meta.previousClose,
          );
          const reportedChange = finiteOrNull(meta.regularMarketChangePercent);
          const quote: PriceResult = {
            price,
            change24h:
              reportedChange ??
              (previous ? (price / previous - 1) * 100 : null),
            marketCap: finiteOrNull(meta.marketCap),
            volume24h: finiteOrNull(meta.regularMarketVolume),
            liquidity: null,
            provider: 'Yahoo Finance',
            updatedAt:
              Number(meta.regularMarketTime) > 0
                ? Number(meta.regularMarketTime) * 1000
                : now,
          };
          for (const holding of tickerHoldings) prices[holding.id] = quote;
          return null;
        } catch (error) {
          return error instanceof Error
            ? error.message
            : `Stock pricing failed for ${ticker}`;
        }
      },
    );
    warnings.push(
      ...stockWarnings.filter((warning): warning is string => warning != null),
    );
  }

  const hyperliquidHoldings = holdings.filter(
    (holding) =>
      holding.source === 'hyperliquid' ||
      holding.importedFrom === 'hyperliquid',
  );
  if (hyperliquidHoldings.length) {
    const [perpResult, spotResult] = await Promise.allSettled([
      fetchHyperliquid<HyperliquidPerpMarket>({ type: 'metaAndAssetCtxs' }),
      fetchHyperliquid<HyperliquidSpotMarket>({ type: 'spotMetaAndAssetCtxs' }),
    ]);
    if (perpResult.status === 'rejected')
      warnings.push('Hyperliquid perpetual marks are temporarily unavailable.');
    if (spotResult.status === 'rejected')
      warnings.push('Hyperliquid spot marks are temporarily unavailable.');
    const perpMarket =
      perpResult.status === 'fulfilled' ? perpResult.value : undefined;
    const spotMarket =
      spotResult.status === 'fulfilled' ? spotResult.value : undefined;

    for (const holding of hyperliquidHoldings) {
      if (holding.positionType === 'perp') {
        const marketIndex =
          perpMarket?.[0]?.universe?.findIndex(
            (market) =>
              market.name?.toUpperCase() === holding.symbol.toUpperCase(),
          ) ?? -1;
        const context =
          marketIndex >= 0 ? perpMarket?.[1]?.[marketIndex] : undefined;
        const price = positiveOrUndefined(context?.markPx ?? context?.midPx);
        if (!price) continue;
        prices[holding.id] = hyperliquidResult(price, context, undefined, now);
        continue;
      }

      const meta = spotMarket?.[0];
      const token = meta?.tokens?.find(
        (item) => item.name?.toUpperCase() === holding.symbol.toUpperCase(),
      );
      const pair = holding.marketRef
        ? meta?.universe?.find((item) => item.name === holding.marketRef)
        : token
          ? meta?.universe?.find(
              (item) =>
                item.tokens?.[0] === token.index && item.tokens?.[1] === 0,
            )
          : undefined;
      const context = pair?.name
        ? spotMarket?.[1]?.find((item) => item.coin === pair.name)
        : undefined;
      const price = positiveOrUndefined(context?.markPx ?? context?.midPx);
      if (!price) continue;
      prices[holding.id] = hyperliquidResult(price, context, token, now);
    }
  }

  const lighterHoldings = holdings.filter(
    (holding) =>
      holding.positionType === 'perp' &&
      (holding.source === 'lighter' || holding.importedFrom === 'lighter'),
  );
  if (lighterHoldings.length) {
    try {
      const response = await fetch(
        'https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails',
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Tessera-Local-Portfolio/1.0',
          },
          signal: AbortSignal.timeout(9_000),
        },
      );
      if (!response.ok) throw new Error(`Lighter returned ${response.status}`);
      const data = (await response.json()) as LighterMarketResponse;
      const markets = data.order_book_details ?? [];
      for (const holding of lighterHoldings) {
        const marketId = Number(holding.marketRef);
        const market = markets.find((candidate) =>
          Number.isFinite(marketId)
            ? Number(candidate.market_id) === marketId
            : candidate.symbol?.toUpperCase() === holding.symbol.toUpperCase(),
        );
        const price = positiveOrUndefined(market?.mark_price);
        if (!price) continue;
        prices[holding.id] = {
          price,
          change24h: finiteOrNull(market?.daily_price_change),
          marketCap: null,
          volume24h: finiteOrNull(market?.daily_quote_token_volume),
          liquidity: null,
          provider: 'Lighter',
          updatedAt: now,
          maintenanceMarginRate:
            finiteOrNull(market?.maintenance_margin_fraction) != null
              ? Number(market?.maintenance_margin_fraction) / 100
              : undefined,
        };
      }
    } catch (error) {
      warnings.push(
        error instanceof Error
          ? error.message
          : 'Lighter marks are temporarily unavailable.',
      );
    }
  }

  const onchain = holdings.filter(
    (item) => item.source === 'dexscreener' && item.address && item.network,
  );
  const byNetwork = new Map<string, IncomingHolding[]>();
  for (const holding of onchain) {
    const network = sanitizeNetwork(holding.network as string);
    if (!network) continue;
    byNetwork.set(network, [...(byNetwork.get(network) ?? []), holding]);
  }

  await Promise.all(
    Array.from(byNetwork.entries()).map(async ([network, networkHoldings]) => {
      for (let index = 0; index < networkHoldings.length; index += 30) {
        const batch = networkHoldings.slice(index, index + 30);
        const addresses = batch.map((item) => item.address as string).join(',');
        try {
          const response = await fetch(
            `https://api.dexscreener.com/tokens/v1/${encodeURIComponent(network)}/${encodeURIComponent(addresses)}`,
            {
              headers: {
                Accept: 'application/json',
                'User-Agent': 'Tessera-Local-Portfolio/1.0',
              },
              signal: AbortSignal.timeout(9_000),
            },
          );
          if (!response.ok)
            throw new Error(
              `DEX Screener returned ${response.status} for ${network}`,
            );
          const pairs = (await response.json()) as DexPair[];
          for (const holding of batch) {
            const address = (holding.address as string).toLowerCase();
            const matches = pairs.filter(
              (pair) =>
                pair.baseToken?.address?.toLowerCase() === address &&
                Number(pair.priceUsd) > 0,
            );
            const best = matches.sort(
              (a, b) =>
                Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0),
            )[0];
            if (best) {
              prices[holding.id] = {
                price: Number(best.priceUsd),
                change24h: finiteOrNull(best.priceChange?.h24),
                marketCap: finiteOrNull(best.marketCap ?? best.fdv),
                volume24h: finiteOrNull(best.volume?.h24),
                liquidity: finiteOrNull(best.liquidity?.usd),
                provider: `DEX Screener · ${best.dexId ?? network}`,
                updatedAt: now,
              };
            }
          }
        } catch (error) {
          warnings.push(
            error instanceof Error
              ? error.message
              : `Onchain pricing failed for ${network}`,
          );
        }
      }
    }),
  );

  const platformIds: Record<string, string> = {
    ethereum: 'ethereum',
    base: 'base',
    arbitrum: 'arbitrum-one',
    optimism: 'optimistic-ethereum',
    bsc: 'binance-smart-chain',
    polygon: 'polygon-pos',
    avalanche: 'avalanche',
    solana: 'solana',
    gnosischain: 'xdai',
  };
  const geckoFallbacks = new Map<string, IncomingHolding[]>();
  for (const holding of onchain.filter((item) => !prices[item.id])) {
    const platform = platformIds[sanitizeNetwork(holding.network as string)];
    if (platform)
      geckoFallbacks.set(platform, [
        ...(geckoFallbacks.get(platform) ?? []),
        holding,
      ]);
  }
  await Promise.all(
    Array.from(geckoFallbacks.entries()).map(
      async ([platform, platformHoldings]) => {
        const addresses = platformHoldings
          .map((holding) => holding.address as string)
          .join(',');
        const params = new URLSearchParams({
          contract_addresses: addresses,
          vs_currencies: 'usd',
          include_market_cap: 'true',
          include_24hr_vol: 'true',
          include_24hr_change: 'true',
          include_last_updated_at: 'true',
        });
        try {
          const response = await fetch(
            `https://api.coingecko.com/api/v3/simple/token_price/${encodeURIComponent(platform)}?${params}`,
            {
              headers: {
                Accept: 'application/json',
                'User-Agent': 'Tessera-Local-Portfolio/1.0',
              },
              signal: AbortSignal.timeout(9_000),
            },
          );
          if (!response.ok) return;
          const data = (await response.json()) as Record<
            string,
            Record<string, number | null>
          >;
          for (const holding of platformHoldings) {
            const quote =
              data[(holding.address as string).toLowerCase()] ??
              data[holding.address as string];
            if (quote && Number.isFinite(quote.usd)) {
              prices[holding.id] = {
                price: Number(quote.usd),
                change24h: finiteOrNull(quote.usd_24h_change),
                marketCap: finiteOrNull(quote.usd_market_cap),
                volume24h: finiteOrNull(quote.usd_24h_vol),
                liquidity: null,
                provider: 'CoinGecko onchain fallback',
                updatedAt: Number(quote.last_updated_at) * 1000 || now,
              };
            }
          }
        } catch {
          // Unresolved assets are reported below and retain their cached price client-side.
        }
      },
    ),
  );

  const rejectedQuotes = holdings.filter((holding) => {
    const quote = prices[holding.id];
    if (!quote || !isSuspiciousSpotPriceJump(holding, quote)) return false;
    delete prices[holding.id];
    return true;
  });
  if (rejectedQuotes.length)
    warnings.push(
      `${rejectedQuotes.length} unusually high spot quote${rejectedQuotes.length === 1 ? ' was' : 's were'} ignored; last known prices were kept.`,
    );

  const unresolved = holdings
    .filter((holding) => !prices[holding.id])
    .map((holding) => holding.id);
  return Response.json(
    { prices, unresolved, warnings, updatedAt: now },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

type DexPair = {
  dexId?: string;
  priceUsd?: string | null;
  baseToken?: { address?: string };
  priceChange?: { h24?: number | null };
  marketCap?: number | null;
  fdv?: number | null;
  volume?: { h24?: number | null };
  liquidity?: { usd?: number | null };
};

function sanitizeNetwork(value: string) {
  const sanitized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
  const aliases: Record<string, string> = {
    arbitrumone: 'arbitrum',
    bnbchain: 'bsc',
    gnosis: 'gnosischain',
    robinhoodchain: 'robinhood',
  };
  return aliases[sanitized] ?? sanitized;
}

function cleanStockTicker(value: string) {
  const ticker = value.trim().toUpperCase().replace('.', '-');
  return /^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : '';
}

function isVenuePerp(holding: IncomingHolding) {
  return (
    holding.positionType === 'perp' &&
    (holding.importedFrom === 'hyperliquid' ||
      holding.importedFrom === 'lighter')
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<R>,
) {
  const results = Array.from<R>({ length: items.length });
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

function finiteOrNull(value: unknown) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function marketResult(
  price: number,
  provider: string,
  updatedAt: number,
): PriceResult {
  return {
    price,
    change24h: null,
    marketCap: null,
    volume24h: null,
    liquidity: null,
    provider,
    updatedAt,
  };
}

async function fetchHyperliquid<T>(body: Record<string, unknown>) {
  const response = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Tessera-Local-Portfolio/1.0',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(9_000),
  });
  if (!response.ok) throw new Error(`Hyperliquid returned ${response.status}`);
  return response.json() as Promise<T>;
}

function positiveOrUndefined(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function hyperliquidResult(
  price: number,
  context: HyperliquidMarketContext | undefined,
  _token: HyperliquidSpotToken | undefined,
  updatedAt: number,
): PriceResult {
  const previous = positiveOrUndefined(context?.prevDayPx);
  const supply = positiveOrUndefined(context?.circulatingSupply);
  return {
    price,
    change24h: previous ? (price / previous - 1) * 100 : null,
    marketCap: supply ? price * supply : null,
    volume24h: finiteOrNull(context?.dayNtlVlm),
    liquidity: null,
    provider: 'Hyperliquid',
    updatedAt,
  };
}

type HyperliquidMarketContext = {
  coin?: string;
  markPx?: string;
  midPx?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
  circulatingSupply?: string;
};
type HyperliquidSpotToken = { index?: number; name?: string };
type HyperliquidPerpMarket = [
  { universe?: Array<{ name?: string }> },
  HyperliquidMarketContext[],
];
type HyperliquidSpotMarket = [
  {
    tokens?: HyperliquidSpotToken[];
    universe?: Array<{ name?: string; tokens?: number[] }>;
  },
  HyperliquidMarketContext[],
];
type LighterMarketResponse = {
  order_book_details?: Array<{
    market_id?: number;
    symbol?: string;
    mark_price?: string;
    daily_price_change?: number;
    daily_quote_token_volume?: number;
    maintenance_margin_fraction?: number;
  }>;
};
type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: {
        currency?: string;
        regularMarketPrice?: number;
        regularMarketChangePercent?: number;
        regularMarketVolume?: number;
        regularMarketTime?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        marketCap?: number;
      };
    }>;
  };
};
