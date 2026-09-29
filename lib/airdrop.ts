export const RH_AIRDROP_POOL = 11_000_000;
export const AIRDROP_DOCS_CHECKED = '2026-09-29';
export const AIRDROP_SOURCES = {
  announcement:
    'https://robinhood.com/us/en/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/',
  points:
    'https://docs.lighter.xyz/points-program/lighter-on-robinhood-chain-points',
  support:
    'https://robinhood.com/us/en/support/articles/robinhood-wallet-perpetual-futures/#Lighter-Points',
};

export function estimateAirdrop(input: {
  mode: 'points' | 'tokens';
  points: number | null;
  totalPoints: number | null;
  pool: number | null;
  tokens: number | null;
  currentPrice: number | null;
  targetPrice: number | null;
  costs: number | null;
}) {
  const valid = (value: number | null): value is number =>
    value !== null && Number.isFinite(value) && value >= 0;
  const share =
    valid(input.points) &&
    valid(input.totalPoints) &&
    input.totalPoints > 0 &&
    input.points <= input.totalPoints
      ? input.points / input.totalPoints
      : null;
  const allocation =
    input.mode === 'tokens'
      ? valid(input.tokens)
        ? input.tokens
        : null
      : share !== null && valid(input.pool)
        ? share * input.pool
        : null;
  const tokens =
    allocation !== null && Number.isFinite(allocation) ? allocation : null;
  const valueAt = (price: number | null) => {
    if (tokens === null || !valid(price)) return null;
    const result = tokens * price;
    return Number.isFinite(result) ? result : null;
  };
  const currentValue = valueAt(input.currentPrice);
  const targetValue = valueAt(input.targetPrice);
  const costs = valid(input.costs) ? input.costs : 0;
  return {
    share: input.mode === 'points' ? share : null,
    tokens,
    currentValue,
    targetValue,
    targetNet: targetValue === null ? null : targetValue - costs,
    breakEvenPrice: tokens !== null && tokens > 0 ? costs / tokens : null,
    targetChange:
      input.currentPrice !== null &&
      input.currentPrice > 0 &&
      valid(input.targetPrice)
        ? (input.targetPrice / input.currentPrice - 1) * 100
        : null,
  };
}

export function parseAirdropNumber(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// datetime-local supplies no zone; this planner explicitly treats it as UTC.
export function airdropDeadlineUtc(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}:00Z`);
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 16) === value
    ? timestamp
    : null;
}

export type AirdropQuote = {
  price: number;
  fetchedAt: number;
  source: string;
};

// Match the venue's exact LIT contract, never a ticker-search result.
export function readLitMark(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const markets = (payload as { order_book_details?: unknown })
    .order_book_details;
  if (!Array.isArray(markets)) return null;
  const market = markets.find(
    (item) =>
      item &&
      item.symbol === 'LIT' &&
      item.market_type === 'perp' &&
      item.status === 'active',
  );
  const price = Number(market?.mark_price);
  return Number.isFinite(price) && price > 0 ? price : null;
}
