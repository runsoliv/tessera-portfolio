export const FUNDING_VENUES = ['Robinhood Lighter', 'Variational'] as const;

export type FundingVenue = (typeof FUNDING_VENUES)[number];

export type FundingQuote = {
  venue: FundingVenue;
  symbol: string;
  marketId: number | null;
  fundingRate8h: number;
  nativeRate: number;
  intervalSeconds: number;
  markPrice: number | null;
  openInterest: number | null;
  volume24h: number | null;
  updatedAt: number;
};

export type FundingOpportunity = {
  symbol: string;
  quotes: FundingQuote[];
  longVenue: FundingVenue;
  shortVenue: FundingVenue;
  longRate8h: number;
  shortRate8h: number;
  spread8h: number;
  annualizedSpread: number;
  markDispersionBps: number | null;
};

export type SimulatedArbPosition = {
  calculationVersion: 2;
  id: string;
  symbol: string;
  status: 'open' | 'closed';
  longVenue: FundingVenue;
  shortVenue: FundingVenue;
  notionalPerLeg: number;
  openedAt: number;
  closedAt: number | null;
  lastMarkedAt: number;
  entryLongRate8h: number;
  entryShortRate8h: number;
  entrySpread8h: number;
  entryLongMarkPrice: number | null;
  entryShortMarkPrice: number | null;
  currentLongRate8h: number;
  currentShortRate8h: number;
  currentSpread8h: number;
  currentLongNativeRate: number;
  currentShortNativeRate: number;
  longIntervalSeconds: number;
  shortIntervalSeconds: number;
  nextLongSettlementAt: number;
  nextShortSettlementAt: number;
  settlementCount: number;
  longQuantity: number | null;
  shortQuantity: number | null;
  currentLongNotional: number;
  currentShortNotional: number;
  accruedGrossCarry: number;
  executionCostBpsPerFill: number;
  expectedHoldHours: number;
  alertSpread8h: number;
  alertTriggeredAt: number | null;
  notifiedAt: number | null;
  connectedLighterLeg: {
    holdingIds: string[];
    accountLabel: string;
    side: 'long' | 'short';
    quantity: number;
    entryPrice: number | null;
    markPrice: number;
  } | null;
  connectedLegMissing: boolean;
};

export type LighterFundingRate = {
  market_id?: unknown;
  exchange?: unknown;
  symbol?: unknown;
  rate?: unknown;
};

export type LighterFundingPayment = {
  timestamp?: unknown;
  rate?: unknown;
  direction?: unknown;
};

export type FundingHistoryPoint = {
  timestamp: number;
  nativeRate: number;
  fundingRate8h: number;
};

export type LighterMarket = {
  symbol?: unknown;
  market_type?: unknown;
  status?: unknown;
  mark_price?: unknown;
  open_interest?: unknown;
  daily_quote_token_volume?: unknown;
};

export type VariationalListing = {
  ticker?: unknown;
  funding_rate?: unknown;
  funding_interval_s?: unknown;
  mark_price?: unknown;
  volume_24h?: unknown;
  open_interest?: {
    long_open_interest?: unknown;
    short_open_interest?: unknown;
  };
  quotes?: { updated_at?: unknown };
};

export function normalizeLighterQuotes(
  venue: Extract<FundingVenue, 'Robinhood Lighter'>,
  rates: LighterFundingRate[],
  markets: LighterMarket[],
  now = Date.now(),
): FundingQuote[] {
  const marketBySymbol = new Map(
    markets
      .filter(
        (market) =>
          typeof market.symbol === 'string' &&
          market.market_type === 'perp' &&
          market.status === 'active',
      )
      .map((market) => [cleanSymbol(market.symbol as string), market]),
  );
  const quotes = new Map<string, FundingQuote>();

  for (const rate of rates) {
    if (
      rate.exchange !== 'lighter' ||
      typeof rate.symbol !== 'string' ||
      !isFiniteNumber(rate.rate)
    )
      continue;

    const symbol = cleanSymbol(rate.symbol);
    const market = marketBySymbol.get(symbol);
    if (!symbol || !market) continue;

    // The comparison endpoint is 8h-equivalent. RH Lighter itself settles
    // hourly, so retain both representations rather than labeling 8h as the
    // native payment interval.
    const fundingRate8h = Number(rate.rate);
    quotes.set(symbol, {
      venue,
      symbol,
      marketId: finiteOrNull(rate.market_id),
      fundingRate8h,
      nativeRate: fundingRate8h / 8,
      intervalSeconds: 3_600,
      markPrice: finiteOrNull(market.mark_price),
      openInterest: finiteOrNull(market.open_interest),
      volume24h: finiteOrNull(market.daily_quote_token_volume),
      updatedAt: now,
    });
  }

  return [...quotes.values()];
}

export function normalizeVariationalQuotes(
  listings: VariationalListing[],
  now = Date.now(),
): FundingQuote[] {
  const quotes = new Map<string, FundingQuote>();

  for (const listing of listings) {
    if (
      typeof listing.ticker !== 'string' ||
      !isFiniteNumber(listing.funding_rate) ||
      !isFiniteNumber(listing.funding_interval_s) ||
      Number(listing.funding_interval_s) <= 0
    )
      continue;

    const symbol = cleanSymbol(listing.ticker);
    // Variational publishes percentage points (0.1095 means 0.1095%), while
    // Lighter's comparison feed publishes a fractional 8h rate.
    const nativeRate = Number(listing.funding_rate) / 100;
    const intervalSeconds = Number(listing.funding_interval_s);
    const longOpenInterest = finiteOrZero(
      listing.open_interest?.long_open_interest,
    );
    const shortOpenInterest = finiteOrZero(
      listing.open_interest?.short_open_interest,
    );
    const quoteTimestamp =
      typeof listing.quotes?.updated_at === 'string'
        ? Date.parse(listing.quotes.updated_at)
        : Number.NaN;

    quotes.set(symbol, {
      venue: 'Variational',
      symbol,
      marketId: null,
      fundingRate8h: nativeRate * (28_800 / intervalSeconds),
      nativeRate,
      intervalSeconds,
      markPrice: finiteOrNull(listing.mark_price),
      openInterest:
        longOpenInterest + shortOpenInterest > 0
          ? longOpenInterest + shortOpenInterest
          : null,
      volume24h: finiteOrNull(listing.volume_24h),
      updatedAt: Number.isFinite(quoteTimestamp) ? quoteTimestamp : now,
    });
  }

  return [...quotes.values()];
}

export function normalizeLighterFundingHistory(
  payments: LighterFundingPayment[],
): FundingHistoryPoint[] {
  return payments
    .filter(
      (payment) =>
        isFiniteNumber(payment.timestamp) && isFiniteNumber(payment.rate),
    )
    .map((payment) => {
      const magnitude = Math.abs(Number(payment.rate)) / 100;
      const direction =
        payment.direction === 'short'
          ? -1
          : payment.direction === 'long'
            ? 1
            : Math.sign(Number(payment.rate)) || 1;
      const nativeRate = magnitude * direction;
      return {
        timestamp: Number(payment.timestamp) * 1_000,
        nativeRate,
        fundingRate8h: nativeRate * 8,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function nextFundingBoundary(now: number, intervalSeconds: number) {
  const intervalMs = Math.max(1, intervalSeconds) * 1_000;
  return (Math.floor(now / intervalMs) + 1) * intervalMs;
}

export function buildFundingOpportunities(
  quotes: FundingQuote[],
): FundingOpportunity[] {
  const bySymbol = new Map<string, FundingQuote[]>();
  for (const quote of quotes) {
    const current = bySymbol.get(quote.symbol) ?? [];
    current.push(quote);
    bySymbol.set(quote.symbol, current);
  }

  return [...bySymbol.entries()]
    .filter(([, symbolQuotes]) => symbolQuotes.length >= 2)
    .map(([symbol, symbolQuotes]) => {
      const sortedQuotes = [...symbolQuotes].sort(
        (a, b) => a.fundingRate8h - b.fundingRate8h,
      );
      const longQuote = sortedQuotes[0];
      const shortQuote = sortedQuotes.at(-1) as FundingQuote;
      const spread8h = shortQuote.fundingRate8h - longQuote.fundingRate8h;
      const marks = sortedQuotes
        .map((quote) => quote.markPrice)
        .filter(
          (price): price is number =>
            price !== null && Number.isFinite(price) && price > 0,
        );
      const markDispersionBps =
        marks.length >= 2
          ? ((Math.max(...marks) - Math.min(...marks)) / Math.min(...marks)) *
            10_000
          : null;

      return {
        symbol,
        quotes: sortedQuotes,
        longVenue: longQuote.venue,
        shortVenue: shortQuote.venue,
        longRate8h: longQuote.fundingRate8h,
        shortRate8h: shortQuote.fundingRate8h,
        spread8h,
        annualizedSpread: spread8h * 3 * 365,
        markDispersionBps,
      };
    })
    .sort(
      (a, b) => b.spread8h - a.spread8h || a.symbol.localeCompare(b.symbol),
    );
}

export function estimateFundingCarry({
  opportunity,
  notionalPerLeg,
  holdHours,
  executionCostBpsPerFill,
  connectedLegAlreadyOpen = false,
  startAt = Date.now(),
}: {
  opportunity: FundingOpportunity;
  notionalPerLeg: number;
  holdHours: number;
  executionCostBpsPerFill: number;
  connectedLegAlreadyOpen?: boolean;
  startAt?: number;
}) {
  const notional = Math.max(0, notionalPerLeg);
  const hours = Math.max(0, holdHours);
  const costPerFill = Math.max(0, executionCostBpsPerFill);
  const longQuote = opportunity.quotes.find(
    (quote) => quote.venue === opportunity.longVenue,
  );
  const shortQuote = opportunity.quotes.find(
    (quote) => quote.venue === opportunity.shortVenue,
  );
  const longSettlements = longQuote
    ? countFundingSettlements(startAt, hours, longQuote.intervalSeconds)
    : 0;
  const shortSettlements = shortQuote
    ? countFundingSettlements(startAt, hours, shortQuote.intervalSeconds)
    : 0;
  const longFunding = longQuote
    ? -notional * longQuote.nativeRate * longSettlements
    : 0;
  const shortFunding = shortQuote
    ? notional * shortQuote.nativeRate * shortSettlements
    : 0;
  const grossCarry = longFunding + shortFunding;
  const executionCost =
    notional * (costPerFill / 10_000) * (connectedLegAlreadyOpen ? 3 : 4);

  return {
    grossCarry,
    longFunding,
    shortFunding,
    longSettlements,
    shortSettlements,
    executionCost,
    netCarry: grossCarry - executionCost,
    breakEvenHours: firstProfitableSettlementHours({
      startAt,
      notional,
      executionCost,
      longQuote,
      shortQuote,
    }),
  };
}

export function openSimulatedArbPosition({
  id,
  opportunity,
  notionalPerLeg,
  executionCostBpsPerFill,
  expectedHoldHours,
  alertSpread8h,
  longQuantity,
  shortQuantity,
  connectedLighterLeg = null,
  now = Date.now(),
}: {
  id: string;
  opportunity: FundingOpportunity;
  notionalPerLeg: number;
  executionCostBpsPerFill: number;
  expectedHoldHours: number;
  alertSpread8h: number;
  longQuantity?: number | null;
  shortQuantity?: number | null;
  connectedLighterLeg?: SimulatedArbPosition['connectedLighterLeg'];
  now?: number;
}): SimulatedArbPosition {
  const longQuote = opportunity.quotes.find(
    (quote) => quote.venue === opportunity.longVenue,
  );
  const shortQuote = opportunity.quotes.find(
    (quote) => quote.venue === opportunity.shortVenue,
  );
  const safeNotional = Math.max(0, notionalPerLeg);
  const resolvedLongQuantity =
    longQuantity ?? quantityFromNotional(safeNotional, longQuote?.markPrice);
  const resolvedShortQuantity =
    shortQuantity ?? quantityFromNotional(safeNotional, shortQuote?.markPrice);
  return {
    calculationVersion: 2,
    id,
    symbol: opportunity.symbol,
    status: 'open',
    longVenue: opportunity.longVenue,
    shortVenue: opportunity.shortVenue,
    notionalPerLeg: safeNotional,
    openedAt: now,
    closedAt: null,
    lastMarkedAt: now,
    entryLongRate8h: opportunity.longRate8h,
    entryShortRate8h: opportunity.shortRate8h,
    entrySpread8h: opportunity.spread8h,
    entryLongMarkPrice: longQuote?.markPrice ?? null,
    entryShortMarkPrice: shortQuote?.markPrice ?? null,
    currentLongRate8h: opportunity.longRate8h,
    currentShortRate8h: opportunity.shortRate8h,
    currentSpread8h: opportunity.spread8h,
    currentLongNativeRate: longQuote?.nativeRate ?? 0,
    currentShortNativeRate: shortQuote?.nativeRate ?? 0,
    longIntervalSeconds: longQuote?.intervalSeconds ?? 28_800,
    shortIntervalSeconds: shortQuote?.intervalSeconds ?? 28_800,
    nextLongSettlementAt: nextFundingBoundary(
      now,
      longQuote?.intervalSeconds ?? 28_800,
    ),
    nextShortSettlementAt: nextFundingBoundary(
      now,
      shortQuote?.intervalSeconds ?? 28_800,
    ),
    settlementCount: 0,
    longQuantity: resolvedLongQuantity,
    shortQuantity: resolvedShortQuantity,
    currentLongNotional: notionalFromQuantity(
      resolvedLongQuantity,
      longQuote?.markPrice,
      safeNotional,
    ),
    currentShortNotional: notionalFromQuantity(
      resolvedShortQuantity,
      shortQuote?.markPrice,
      safeNotional,
    ),
    accruedGrossCarry: 0,
    executionCostBpsPerFill: Math.max(0, executionCostBpsPerFill),
    expectedHoldHours: Math.max(0, expectedHoldHours),
    alertSpread8h,
    alertTriggeredAt: null,
    notifiedAt: null,
    connectedLighterLeg,
    connectedLegMissing: false,
  };
}

export function markSimulatedArbPosition(
  position: SimulatedArbPosition,
  opportunity: FundingOpportunity | undefined,
  now = Date.now(),
): SimulatedArbPosition {
  if (position.status === 'closed' || !opportunity) return position;

  const longQuote = opportunity.quotes.find(
    (quote) => quote.venue === position.longVenue,
  );
  const shortQuote = opportunity.quotes.find(
    (quote) => quote.venue === position.shortVenue,
  );
  if (!longQuote || !shortQuote) return position;

  const legacyCalculation = position.calculationVersion !== 2;
  const longIntervalSeconds =
    (legacyCalculation ? null : positiveFinite(position.longIntervalSeconds)) ??
    longQuote.intervalSeconds;
  const shortIntervalSeconds =
    (legacyCalculation
      ? null
      : positiveFinite(position.shortIntervalSeconds)) ??
    shortQuote.intervalSeconds;
  let nextLongSettlementAt =
    positiveFinite(position.nextLongSettlementAt) ??
    nextFundingBoundary(position.lastMarkedAt, longIntervalSeconds);
  let nextShortSettlementAt =
    positiveFinite(position.nextShortSettlementAt) ??
    nextFundingBoundary(position.lastMarkedAt, shortIntervalSeconds);
  const currentLongNativeRate = Number.isFinite(position.currentLongNativeRate)
    ? position.currentLongNativeRate
    : longQuote.nativeRate;
  const currentShortNativeRate = Number.isFinite(
    position.currentShortNativeRate,
  )
    ? position.currentShortNativeRate
    : shortQuote.nativeRate;
  const currentLongNotional = notionalFromQuantity(
    position.longQuantity,
    longQuote.markPrice,
    position.currentLongNotional || position.notionalPerLeg,
  );
  const currentShortNotional = notionalFromQuantity(
    position.shortQuantity,
    shortQuote.markPrice,
    position.currentShortNotional || position.notionalPerLeg,
  );
  let accruedGrossCarry = legacyCalculation ? 0 : position.accruedGrossCarry;
  let settlementCount = legacyCalculation ? 0 : (position.settlementCount ?? 0);
  while (nextLongSettlementAt <= now) {
    accruedGrossCarry -= currentLongNotional * currentLongNativeRate;
    settlementCount += 1;
    nextLongSettlementAt += longIntervalSeconds * 1_000;
  }
  while (nextShortSettlementAt <= now) {
    accruedGrossCarry += currentShortNotional * currentShortNativeRate;
    settlementCount += 1;
    nextShortSettlementAt += shortIntervalSeconds * 1_000;
  }
  const currentSpread8h = shortQuote.fundingRate8h - longQuote.fundingRate8h;
  const alertTriggered = currentSpread8h <= position.alertSpread8h;

  return {
    ...position,
    calculationVersion: 2,
    lastMarkedAt: Math.max(position.lastMarkedAt, now),
    currentLongRate8h: longQuote.fundingRate8h,
    currentShortRate8h: shortQuote.fundingRate8h,
    currentSpread8h,
    currentLongNativeRate: longQuote.nativeRate,
    currentShortNativeRate: shortQuote.nativeRate,
    longIntervalSeconds,
    shortIntervalSeconds,
    nextLongSettlementAt,
    nextShortSettlementAt,
    settlementCount,
    currentLongNotional,
    currentShortNotional,
    accruedGrossCarry,
    alertTriggeredAt:
      alertTriggered && position.alertTriggeredAt === null
        ? now
        : position.alertTriggeredAt,
  };
}

export function simulatedArbRoundTripCost(position: SimulatedArbPosition) {
  const longNotional =
    positiveFinite(position.currentLongNotional) ?? position.notionalPerLeg;
  const shortNotional =
    positiveFinite(position.currentShortNotional) ?? position.notionalPerLeg;
  const rate = position.executionCostBpsPerFill / 10_000;
  if (position.connectedLighterLeg) {
    const connectedNotional =
      position.connectedLighterLeg.side === 'long'
        ? longNotional
        : shortNotional;
    const hedgeNotional =
      position.connectedLighterLeg.side === 'long'
        ? shortNotional
        : longNotional;
    return connectedNotional * rate + hedgeNotional * rate * 2;
  }
  return (longNotional + shortNotional) * rate * 2;
}

export function countFundingSettlements(
  startAt: number,
  holdHours: number,
  intervalSeconds: number,
) {
  if (!(holdHours > 0) || !(intervalSeconds > 0)) return 0;
  const first = nextFundingBoundary(startAt, intervalSeconds);
  const end = startAt + holdHours * 3_600_000;
  if (first > end) return 0;
  return Math.floor((end - first) / (intervalSeconds * 1_000)) + 1;
}

function firstProfitableSettlementHours({
  startAt,
  notional,
  executionCost,
  longQuote,
  shortQuote,
}: {
  startAt: number;
  notional: number;
  executionCost: number;
  longQuote: FundingQuote | undefined;
  shortQuote: FundingQuote | undefined;
}) {
  if (!longQuote || !shortQuote || !(notional > 0)) return null;
  let total = 0;
  let nextLong = nextFundingBoundary(startAt, longQuote.intervalSeconds);
  let nextShort = nextFundingBoundary(startAt, shortQuote.intervalSeconds);
  const limit = startAt + 365 * 24 * 3_600_000;
  while (Math.min(nextLong, nextShort) <= limit) {
    const next = Math.min(nextLong, nextShort);
    if (nextLong === next) {
      total -= notional * longQuote.nativeRate;
      nextLong += longQuote.intervalSeconds * 1_000;
    }
    if (nextShort === next) {
      total += notional * shortQuote.nativeRate;
      nextShort += shortQuote.intervalSeconds * 1_000;
    }
    if (total >= executionCost) return (next - startAt) / 3_600_000;
  }
  return null;
}

function quantityFromNotional(
  notional: number,
  markPrice: number | null | undefined,
) {
  return markPrice && markPrice > 0 ? notional / markPrice : null;
}

function notionalFromQuantity(
  quantity: number | null | undefined,
  markPrice: number | null | undefined,
  fallback: number,
) {
  return quantity != null && quantity > 0 && markPrice && markPrice > 0
    ? quantity * markPrice
    : Math.max(0, fallback);
}

function positiveFinite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function cleanSymbol(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isFiniteNumber(value: unknown) {
  return value !== null && value !== '' && Number.isFinite(Number(value));
}

function finiteOrNull(value: unknown) {
  return isFiniteNumber(value) ? Number(value) : null;
}

function finiteOrZero(value: unknown) {
  return isFiniteNumber(value) ? Number(value) : 0;
}
