import type { Holding, PriceResult } from './portfolio.ts';

// A transient token-feed mix-up must not turn an existing spot holding into
// an eightfold (or larger) gain between refreshes. Downward corrections remain
// allowed so a previously bad saved quote can recover automatically.
export function isSuspiciousSpotPriceJump(
  holding: Pick<
    Holding,
    'source' | 'positionType' | 'price' | 'manualPrice'
  >,
  quote: Pick<PriceResult, 'price'>,
) {
  if (
    holding.source !== 'coingecko' &&
    holding.source !== 'dexscreener'
  )
    return false;
  if (holding.positionType === 'perp') return false;
  const previous = Number(holding.price ?? holding.manualPrice);
  const next = Number(quote.price);
  return previous > 0 && next > previous * 8;
}
