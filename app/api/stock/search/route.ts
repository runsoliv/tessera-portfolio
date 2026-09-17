import type { AssetOption } from '@/lib/portfolio';

const CURATED_STOCKS: AssetOption[] = [
  { id: 'stock:AAPL', name: 'Apple Inc.', symbol: 'AAPL', network: 'NASDAQ' },
  { id: 'stock:MSFT', name: 'Microsoft Corporation', symbol: 'MSFT', network: 'NASDAQ' },
  { id: 'stock:NVDA', name: 'NVIDIA Corporation', symbol: 'NVDA', network: 'NASDAQ' },
  { id: 'stock:AMZN', name: 'Amazon.com, Inc.', symbol: 'AMZN', network: 'NASDAQ' },
  { id: 'stock:GOOGL', name: 'Alphabet Inc.', symbol: 'GOOGL', network: 'NASDAQ' },
  { id: 'stock:META', name: 'Meta Platforms, Inc.', symbol: 'META', network: 'NASDAQ' },
  { id: 'stock:TSLA', name: 'Tesla, Inc.', symbol: 'TSLA', network: 'NASDAQ' },
  { id: 'stock:BRK-B', name: 'Berkshire Hathaway Inc.', symbol: 'BRK-B', network: 'NYSE' },
  { id: 'stock:JPM', name: 'JPMorgan Chase & Co.', symbol: 'JPM', network: 'NYSE' },
  { id: 'stock:V', name: 'Visa Inc.', symbol: 'V', network: 'NYSE' },
  { id: 'stock:SPY', name: 'SPDR S&P 500 ETF Trust', symbol: 'SPY', network: 'NYSE Arca' },
  { id: 'stock:QQQ', name: 'Invesco QQQ Trust', symbol: 'QQQ', network: 'NASDAQ' },
];

const US_EXCHANGES = new Set(['ASE', 'BTS', 'NCM', 'NGM', 'NMS', 'NAS', 'NYQ', 'PCX']);

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim().slice(0, 50) ?? '';
  if (!query) return stockResponse(CURATED_STOCKS);
  const normalizedQuery = normalizeSearchText(query);
  const curatedMatches = CURATED_STOCKS.filter((asset) => normalizeSearchText(`${asset.symbol} ${asset.name}`).includes(normalizedQuery));

  try {
    const params = new URLSearchParams({ q: query, quotesCount: '14', newsCount: '0' });
    const response = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?${params}`, {
      headers: yahooHeaders(),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Yahoo Finance returned ${response.status}`);
    const data = (await response.json()) as YahooSearchResponse;
    const providerResults = (data.quotes ?? [])
      .filter((quote) => (quote.quoteType === 'EQUITY' || quote.quoteType === 'ETF') && (!quote.exchange || US_EXCHANGES.has(quote.exchange)))
      .map(toAssetOption)
      .filter((asset): asset is AssetOption => asset != null);
    const results = Array.from(new Map([...curatedMatches, ...providerResults].map((asset) => [asset.symbol, asset])).values()).slice(0, 12);

    if (results.length) return stockResponse(results);
  } catch {
    // A curated local fallback keeps ticker entry usable during provider outages.
  }

  const fallback = [...curatedMatches];
  const ticker = cleanTicker(query);
  if (ticker && !fallback.some((asset) => asset.symbol === ticker)) {
    fallback.unshift({ id: `stock:${ticker}`, name: ticker, symbol: ticker, network: 'US market' });
  }
  return stockResponse(fallback.slice(0, 12));
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase().replaceAll('.', '-');
}

function toAssetOption(quote: YahooSearchQuote): AssetOption | null {
  const symbol = cleanTicker(quote.symbol ?? '');
  if (!symbol) return null;
  return {
    id: `stock:${symbol}`,
    name: quote.longname?.trim() || quote.shortname?.trim() || symbol,
    symbol,
    network: quote.exchDisp?.trim() || quote.exchange?.trim() || 'US market',
  };
}

function cleanTicker(value: string) {
  const ticker = value.trim().toUpperCase().replace('.', '-');
  return /^[A-Z][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : '';
}

function yahooHeaders() {
  return {
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (compatible; Tessera-Local-Portfolio/1.0)',
  };
}

function stockResponse(results: AssetOption[]) {
  return Response.json({ results, provider: 'Yahoo Finance' }, { headers: { 'Cache-Control': 'public, max-age=60' } });
}

type YahooSearchResponse = { quotes?: YahooSearchQuote[] };
type YahooSearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  exchDisp?: string;
  quoteType?: string;
};
