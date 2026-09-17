import { CURATED_ASSETS } from '@/lib/portfolio';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  const localMatches = CURATED_ASSETS.filter((asset) =>
    `${asset.name} ${asset.symbol} ${asset.id}`.toLowerCase().includes(query.toLowerCase()),
  ).slice(0, 12);

  if (query.length < 2) {
    return Response.json({ results: localMatches.length ? localMatches : CURATED_ASSETS.slice(0, 12), provider: 'local' });
  }

  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Tessera-Local-Portfolio/1.0' },
      signal: AbortSignal.timeout(7_000),
    });
    if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
    const data = (await response.json()) as { coins?: Array<{ id: string; name: string; symbol: string; market_cap_rank?: number | null }> };
    const remote = (data.coins ?? []).slice(0, 18).map((coin) => ({
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol.toUpperCase(),
      network: 'Market asset',
      rank: coin.market_cap_rank ?? null,
    }));
    const byId = new Map([...localMatches, ...remote].map((asset) => [asset.id, asset]));
    return Response.json({ results: Array.from(byId.values()).slice(0, 18), provider: 'CoinGecko' }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch {
    return Response.json({ results: localMatches, provider: 'local', degraded: true });
  }
}
