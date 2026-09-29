import assert from 'node:assert/strict';
import test from 'node:test';
import {
  airdropDeadlineUtc,
  estimateAirdrop,
  parseAirdropNumber,
  readLitMark,
} from '../lib/airdrop.ts';

const input = {
  mode: 'points' as const,
  points: 1_000,
  totalPoints: 1_000_000,
  pool: 11_000_000,
  tokens: null,
  currentPrice: 4,
  targetPrice: 6,
  costs: 500,
};

void test('RH allocation uses recorded points once and values the same LIT amount at both prices', () => {
  const result = estimateAirdrop(input);
  assert.equal(result.tokens, 11_000);
  assert.equal(result.currentValue, 44_000);
  assert.equal(result.targetValue, 66_000);
  assert.equal(result.targetNet, 65_500);
  assert.equal(result.targetChange, 50);
});

void test('unknown or impossible point totals never produce an allocation', () => {
  for (const totalPoints of [
    null,
    0,
    999,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.equal(estimateAirdrop({ ...input, totalPoints }).tokens, null);
  }
  assert.equal(parseAirdropNumber(''), null);
  assert.equal(parseAirdropNumber('-1'), null);
  assert.equal(
    estimateAirdrop({ ...input, currentPrice: null }).currentValue,
    null,
  );
  assert.equal(estimateAirdrop({ ...input, targetPrice: 0 }).targetValue, 0);
});

void test('direct LIT estimates do not require a speculative program point total', () => {
  const result = estimateAirdrop({
    ...input,
    mode: 'tokens',
    tokens: 250,
    totalPoints: null,
  });
  assert.equal(result.tokens, 250);
  assert.equal(result.currentValue, 1_000);
  assert.equal(result.share, null);
});

void test('countdown date is UTC and rejects impossible dates', () => {
  assert.equal(
    airdropDeadlineUtc('2026-10-01T12:00'),
    Date.UTC(2026, 9, 1, 12),
  );
  assert.equal(airdropDeadlineUtc('2026-02-30T12:00'), null);
  assert.equal(airdropDeadlineUtc(''), null);
});

void test('price reader accepts only the active LIT contract and rejects invalid marks', () => {
  const lit = {
    symbol: 'LIT',
    market_type: 'perp',
    status: 'active',
    mark_price: '4.47',
  };
  assert.equal(
    readLitMark({
      order_book_details: [
        { ...lit, symbol: 'BTC', mark_price: '100000' },
        lit,
      ],
    }),
    4.47,
  );
  for (const patch of [
    { symbol: 'LITCOIN' },
    { status: 'inactive' },
    { mark_price: '0' },
    { mark_price: 'NaN' },
    { market_type: 'spot' },
  ]) {
    assert.equal(
      readLitMark({ order_book_details: [{ ...lit, ...patch }] }),
      null,
    );
  }
});
