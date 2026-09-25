import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildFundingOpportunities,
  estimateFundingCarry,
  normalizeLighterQuotes,
  normalizeVariationalQuotes,
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
  assert.equal(variational[0].fundingRate8h, 0.0004);
});

void test('chooses the lower-rate long and higher-rate short', () => {
  const opportunities = buildFundingOpportunities([
    {
      venue: 'Robinhood Lighter',
      symbol: 'ETH',
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
