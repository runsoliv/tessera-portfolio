import {
  normalizeLighterFundingHistory,
  type LighterFundingPayment,
} from '@/lib/funding-arb';

const ROBINHOOD_LIGHTER_BASE_URL = 'https://api.rh.lighter.xyz/api/v1';

type LighterFundingHistoryResponse = {
  fundings?: LighterFundingPayment[];
};

export async function GET(request: Request) {
  const marketId = Number(new URL(request.url).searchParams.get('marketId'));
  if (!Number.isInteger(marketId) || marketId < 0) {
    return Response.json(
      { error: 'A valid Robinhood Lighter marketId is required.' },
      { status: 400 },
    );
  }

  const end = Math.floor(Date.now() / 1_000);
  const start = end - 24 * 60 * 60;
  const url = new URL(`${ROBINHOOD_LIGHTER_BASE_URL}/fundings`);
  url.searchParams.set('market_id', String(marketId));
  url.searchParams.set('resolution', '1h');
  url.searchParams.set('start_timestamp', String(start));
  url.searchParams.set('end_timestamp', String(end));
  url.searchParams.set('count_back', '24');

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Tessera-Funding-Arb/1.0',
      },
      signal: AbortSignal.timeout(9_000),
    });
    if (!response.ok)
      throw new Error(`Funding history returned ${response.status}`);
    const payload = (await response.json()) as LighterFundingHistoryResponse;
    return Response.json(
      {
        marketId,
        points: normalizeLighterFundingHistory(payload.fundings ?? []),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Funding history is unavailable.',
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
