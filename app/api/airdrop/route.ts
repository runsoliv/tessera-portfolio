import { readLitMark } from '@/lib/airdrop';

export async function GET() {
  for (const [source, url] of [
    [
      'Robinhood Lighter · LIT mark',
      'https://api.rh.lighter.xyz/api/v1/orderBookDetails',
    ],
    [
      'Lighter mainnet · LIT mark (fallback)',
      'https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails',
    ],
  ]) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(6_000),
      });
      if (!response.ok) continue;
      const price = readLitMark(await response.json());
      if (price === null) continue;
      return Response.json(
        { price, source, fetchedAt: Date.now() },
        {
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    } catch {
      // Try the other official LIT market. The client retains its last quote.
    }
  }
  return Response.json(
    { error: 'LIT price is temporarily unavailable.' },
    {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
