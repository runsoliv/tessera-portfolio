import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFundingOpportunities,
  estimateFundingCarry,
  markSimulatedArbPosition,
  nextFundingBoundary,
  normalizeLighterQuotes,
  normalizeLighterFundingHistory,
  normalizeVariationalQuotes,
  openSimulatedArbPosition,
  simulatedArbRoundTripCost,
} from '../lib/funding-arb.ts';

void test('normalizes Lighter and Variational rates to an 8h basis', () => {
  const lighter = normalizeLighterQuotes(
    'Robinhood Lighter',
    [{ exchange: 'lighter', symbol: 'BTC', rate: 0.0001 }],
    [
      {
        symbol: 'BTC',
        market_type: 'perp',
        status: 'active',
        mark_price: '100000',
      },
    ],
    1,
  );
  const variational = normalizeVariationalQuotes(
    [
      {
        ticker: 'BTC',
        funding_rate: '0.02',
        funding_interval_s: 14_400,
        mark_price: '100100',
      },
    ],
    1,
  );

  assert.equal(lighter[0].fundingRate8h, 0.0001);
  assert.equal(lighter[0].nativeRate, 0.0000125);
  assert.equal(lighter[0].intervalSeconds, 3_600);
  assert.equal(variational[0].fundingRate8h, 0.0004);
});

void test('normalizes settled hourly Lighter payments and UTC boundaries', () => {
  const points = normalizeLighterFundingHistory([
    { timestamp: 100, rate: '0.01', direction: 'long' },
    { timestamp: 200, rate: '0.02', direction: 'short' },
  ]);

  assert.equal(points[0].nativeRate, 0.0001);
  assert.equal(points[0].fundingRate8h, 0.0008);
  assert.equal(points[1].nativeRate, -0.0002);
  assert.equal(nextFundingBoundary(3_600_001, 3_600), 7_200_000);
});

void test('chooses the lower-rate long and higher-rate short', () => {
  const opportunities = buildFundingOpportunities([
    {
      venue: 'Robinhood Lighter',
      symbol: 'ETH',
      marketId: 1,
      fundingRate8h: -0.0002,
      nativeRate: -0.0002,
      intervalSeconds: 28_800,
      markPrice: 2_000,
      openInterest: null,
      volume24h: null,
      updatedAt: 1,
    },
    {
      venue: 'Variational',
      symbol: 'ETH',
      marketId: null,
      fundingRate8h: 0.0001,
      nativeRate: 0.0001,
      intervalSeconds: 28_800,
      markPrice: 2_002,
      openInterest: null,
      volume24h: null,
      updatedAt: 1,
    },
  ]);

  assert.equal(opportunities[0].longVenue, 'Robinhood Lighter');
  assert.equal(opportunities[0].shortVenue, 'Variational');
  assert.ok(Math.abs(opportunities[0].spread8h - 0.0003) < 1e-12);
  assert.ok(Math.abs((opportunities[0].markDispersionBps ?? 0) - 10) < 1e-9);
});

void test('subtracts four fills from the funding carry estimate', () => {
  const opportunity = buildFundingOpportunities([
    {
      venue: 'Robinhood Lighter',
      symbol: 'SOL',
      marketId: 2,
      fundingRate8h: 0,
      nativeRate: 0,
      intervalSeconds: 28_800,
      markPrice: 100,
      openInterest: null,
      volume24h: null,
      updatedAt: 1,
    },
    {
      venue: 'Variational',
      symbol: 'SOL',
      marketId: null,
      fundingRate8h: 0.001,
      nativeRate: 0.001,
      intervalSeconds: 28_800,
      markPrice: 100,
      openInterest: null,
      volume24h: null,
      updatedAt: 1,
    },
  ])[0];
  const estimate = estimateFundingCarry({
    opportunity,
    notionalPerLeg: 10_000,
    holdHours: 24,
    executionCostBpsPerFill: 2,
  });

  assert.equal(estimate.grossCarry, 30);
  assert.equal(estimate.executionCost, 8);
  assert.equal(estimate.netCarry, 22);
  assert.ok(Math.abs((estimate.breakEvenHours ?? 0) - 6.4) < 1e-9);
});

void test('marks a simulated arb in its original long and short direction', () => {
  const entry = buildFundingOpportunities([
    fundingQuote('Robinhood Lighter', 'BTC', 0.0001),
    fundingQuote('Variational', 'BTC', 0.001),
  ])[0];
  const position = openSimulatedArbPosition({
    id: 'paper-1',
    opportunity: entry,
    notionalPerLeg: 10_000,
    executionCostBpsPerFill: 2,
    expectedHoldHours: 24,
    alertSpread8h: 0.0002,
    now: 1_000,
  });
  const reversed = buildFundingOpportunities([
    fundingQuote('Robinhood Lighter', 'BTC', 0.001),
    fundingQuote('Variational', 'BTC', 0.0001),
  ])[0];
  const afterEightHours = markSimulatedArbPosition(
    position,
    reversed,
    1_000 + 8 * 3_600_000,
  );

  assert.equal(afterEightHours.accruedGrossCarry, 9);
  assert.equal(afterEightHours.currentSpread8h, -0.0009);
  assert.equal(afterEightHours.alertTriggeredAt, 1_000 + 8 * 3_600_000);
  assert.equal(simulatedArbRoundTripCost(afterEightHours), 8);
});

function fundingQuote(
  venue: 'Robinhood Lighter' | 'Variational',
  symbol: string,
  fundingRate8h: number,
) {
  return {
    venue,
    symbol,
    marketId: venue === 'Robinhood Lighter' ? 1 : null,
    fundingRate8h,
    nativeRate: fundingRate8h,
    intervalSeconds: 28_800,
    markPrice: 100,
    openInterest: null,
    volume24h: null,
    updatedAt: 1,
  };
}
