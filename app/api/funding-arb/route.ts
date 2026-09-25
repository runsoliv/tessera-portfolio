import {
  buildFundingOpportunities,
  normalizeLighterQuotes,
  normalizeVariationalQuotes,
  type LighterFundingRate,
  type LighterMarket,
  type VariationalListing,
} from '@/lib/funding-arb';

const ROBINHOOD_LIGHTER_BASE_URL = 'https://api.rh.lighter.xyz/api/v1';
const VARIATIONAL_STATS_URL =
  'https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats';

type LighterRatesResponse = { funding_rates?: LighterFundingRate[] };
type LighterMarketsResponse = { order_book_details?: LighterMarket[] };
type VariationalStatsResponse = { listings?: VariationalListing[] };

export async function GET() {
  const fetchedAt = Date.now();
  const warnings: string[] = [];
  const [robinhoodRates, robinhoodMarkets, vari] = await Promise.all([
    fetchJson<LighterRatesResponse>(
      `${ROBINHOOD_LIGHTER_BASE_URL}/funding-rates`,
      'Robinhood Lighter funding',
      warnings,
    ),
    fetchJson<LighterMarketsResponse>(
      `${ROBINHOOD_LIGHTER_BASE_URL}/orderBookDetails`,
      'Robinhood Lighter markets',
      warnings,
    ),
    fetchJson<VariationalStatsResponse>(
      VARIATIONAL_STATS_URL,
      'Variational funding',
      warnings,
    ),
  ]);
  const robinhoodQuotes = normalizeLighterQuotes(
    'Robinhood Lighter',
    robinhoodRates?.funding_rates ?? [],
    robinhoodMarkets?.order_book_details ?? [],
    fetchedAt,
  );
  const variationalQuotes = normalizeVariationalQuotes(
    vari?.listings ?? [],
    fetchedAt,
  );
  const quotes = [...robinhoodQuotes, ...variationalQuotes];

  return Response.json(
    {
      fetchedAt,
      opportunities: buildFundingOpportunities(quotes),
      sources: [
        { venue: 'Robinhood Lighter', markets: robinhoodQuotes.length },
        { venue: 'Variational', markets: variationalQuotes.length },
      ],
      warnings,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

async function fetchJson<T>(
  url: string,
  label: string,
  warnings: string[],
): Promise<T | null> {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Tessera-Funding-Arb/1.0',
      },
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return (await response.json()) as T;
  } catch (error) {
    warnings.push(
      `${label} unavailable${error instanceof Error ? ` (${error.message})` : ''}`,
    );
    return null;
  }
}
