import assert from 'node:assert/strict';
import test from 'node:test';

import {
  repairCompositionSteps,
  rebasePortfolioSnapshots,
  repairTransientCompositionSpikes,
} from '../lib/history-utils.ts';
import {
  buildDailyPortfolioPnlHistory,
  buildPortfolioHistory,
  buildPortfolioPnlHistory,
  currentUtcDayPnl,
  type PortfolioHistoryPoint,
} from '../lib/venue-history.ts';

void test('tracks cumulative P&L across the whole local portfolio', () => {
  const now = Date.now();
  const history = buildPortfolioPnlHistory(
    [
      { timestamp: now - 120_000, value: 1_000 },
      { timestamp: now - 60_000, value: 1_100 },
    ],
    [],
    1_100,
  );

  assert.equal(history[0]?.value, 0);
  assert.equal(history.at(-1)?.value, 100);
});

void test('position additions and removals do not become portfolio P&L', () => {
  const now = Date.now();
  const snapshots = rebasePortfolioSnapshots(
    [
      { timestamp: now - 120_000, value: 1_000 },
      { timestamp: now - 60_000, value: 1_100 },
    ],
    500,
  );
  const history = buildPortfolioPnlHistory(snapshots, [], 1_600);

  assert.equal(history[0]?.value, 0);
  assert.equal(history.at(-1)?.value, 100);
});

void test('does not rewrite genuine movement after the last saved point', () => {
  const now = Date.now();
  const history = buildPortfolioHistory(
    [
      { timestamp: now - 120_000, value: 14_000 },
      { timestamp: now - 60_000, value: 15_000 },
    ],
    [],
    16_000,
  );

  assert.equal(history[0]?.value, 14_000);
  assert.equal(history[1]?.value, 15_000);
  assert.equal(history.at(-1)?.value, 16_000);
  assert.equal(
    Number(history.at(-1)?.value) - Number(history[0]?.value),
    2_000,
  );
});

void test('removes a large wallet-restoration step from equity and P&L history', () => {
  const now = Date.now();
  const repaired = repairCompositionSteps([
    { timestamp: now - 3 * 60 * 60_000, value: 500 },
    { timestamp: now - 2 * 60 * 60_000, value: 1_500 },
    { timestamp: now - 60 * 60_000, value: 20_500 },
    { timestamp: now, value: 20_700 },
  ]);

  assert.deepEqual(
    repaired.map((point) => point.value),
    [19_500, 20_500, 20_500, 20_700],
  );
});

void test('repairs an overnight remove-and-add-back valley', () => {
  const now = Date.now();
  const repaired = repairTransientCompositionSpikes([
    { timestamp: now - 48 * 60 * 60_000, value: 16_400 },
    { timestamp: now - 24 * 60 * 60_000, value: 14_300 },
    { timestamp: now, value: 17_100 },
  ]);

  assert.deepEqual(
    repaired.map((point) => point.value),
    [16_400, 17_100],
  );
});

void test('keeps a sustained market drawdown in history', () => {
  const now = Date.now();
  const repaired = repairTransientCompositionSpikes([
    { timestamp: now - 48 * 60 * 60_000, value: 16_400 },
    { timestamp: now - 24 * 60 * 60_000, value: 14_300 },
    { timestamp: now, value: 14_500 },
  ]);

  assert.deepEqual(
    repaired.map((point) => point.value),
    [16_400, 14_300, 14_500],
  );
});

void test('uses venue P&L before local whole-portfolio tracking begins', () => {
  const now = Date.now();
  const day = 86_400_000;
  const history = buildPortfolioPnlHistory(
    [
      { timestamp: now - day, value: 2_000 },
      { timestamp: now - 30_000, value: 2_100 },
    ],
    [
      {
        profileId: 'hl-1',
        source: 'hyperliquid',
        platform: 'Hyperliquid',
        address: '0x0000000000000000000000000000000000000000',
        points: [],
        pnlPoints: [
          { timestamp: now - 3 * day, value: 0 },
          { timestamp: now - 2 * day, value: 200 },
          { timestamp: now - day, value: 500 },
        ],
        fetchedAt: now,
        provider: 'Test venue history',
        historyVersion: 3,
      },
    ],
    2_100,
  );

  assert.equal(history[0]?.value, 0);
  assert.equal(history.at(-1)?.value, 600);
  assert.equal(history.at(-1)?.origin, 'local');
});

void test('venue backfill preserves every local whole-portfolio snapshot', () => {
  const now = Date.now();
  const day = 86_400_000;
  const history = buildPortfolioHistory(
    [
      { timestamp: now - day, value: 14_000 },
      { timestamp: now - 30_000, value: 15_000 },
    ],
    [
      {
        profileId: 'hl-local-splice',
        source: 'hyperliquid',
        platform: 'Hyperliquid',
        address: '0x0000000000000000000000000000000000000000',
        points: [],
        pnlPoints: [
          { timestamp: now - 3 * day, value: 0 },
          { timestamp: now - 2 * day, value: 250 },
          { timestamp: now - day, value: 500 },
        ],
        fetchedAt: now,
        provider: 'Test venue history',
        historyVersion: 3,
      },
    ],
    16_000,
  );

  assert.deepEqual(
    history.slice(-3).map((point) => point.value),
    [14_000, 15_000, 16_000],
  );
  assert.equal(
    history.find((point) => point.timestamp === now - day)?.value,
    14_000,
  );
});

void test('removes a corrupt high-value plateau without changing current equity', () => {
  const now = Date.now();
  const history = buildPortfolioHistory(
    [
      { timestamp: now - 4_000, value: 18_500 },
      { timestamp: now - 3_000, value: 19_000 },
      { timestamp: now - 2_000, value: 715_500 },
      { timestamp: now - 1_000, value: 714_900 },
    ],
    [],
    20_616,
  );

  assert.deepEqual(
    history.map((point) => point.value),
    [18_500, 19_000, 20_616],
  );
  assert.equal(history.at(-1)?.value, 20_616);
});

void test('preserves legitimate multi-fold portfolio growth', () => {
  const now = Date.now();
  const history = buildPortfolioHistory(
    [
      { timestamp: now - 3_000, value: 5_500 },
      { timestamp: now - 2_000, value: 12_000 },
      { timestamp: now - 1_000, value: 20_000 },
    ],
    [],
    20_616,
  );

  assert.deepEqual(
    history.map((point) => point.value),
    [5_500, 12_000, 20_000, 20_616],
  );
});

void test('falls back to venue shape when saved local history is corrupt', () => {
  const now = Date.now();
  const day = 86_400_000;
  const history = buildPortfolioHistory(
    [
      { timestamp: now - day, value: 715_500 },
      { timestamp: now - 1_000, value: 714_900 },
    ],
    [
      {
        profileId: 'hl-corrupt-local',
        source: 'hyperliquid',
        platform: 'Hyperliquid',
        address: '0x0000000000000000000000000000000000000000',
        points: [],
        pnlPoints: [
          { timestamp: now - 2 * day, value: 0 },
          { timestamp: now - day, value: 500 },
          { timestamp: now - 1_000, value: 1_400 },
        ],
        fetchedAt: now,
        provider: 'Test venue history',
        historyVersion: 4,
      },
    ],
    20_616,
  );
  const pnl = buildDailyPortfolioPnlHistory(
    history.map((point) => ({
      ...point,
      value: point.value - history[0].value,
    })),
  );

  assert.equal(history[0]?.value, 19_216);
  assert.equal(history.at(-1)?.value, 20_616);
  assert.ok(history.every((point) => point.value < 30_000));
  assert.ok(Math.abs(currentUtcDayPnl(pnl, now)) < 3 * 20_616);
});

void test('groups cumulative performance into positive and negative daily bars', () => {
  const dayOneMorning = Date.UTC(2026, 8, 16, 9);
  const dayOneClose = Date.UTC(2026, 8, 16, 20);
  const dayTwoClose = Date.UTC(2026, 8, 17, 20);
  const cumulative: PortfolioHistoryPoint[] = [
    {
      timestamp: dayOneMorning,
      value: 0,
      origin: 'local',
      sources: ['Local snapshot'],
    },
    {
      timestamp: dayOneClose,
      value: 125,
      origin: 'local',
      sources: ['Local snapshot'],
    },
    {
      timestamp: dayTwoClose,
      value: 75,
      origin: 'local',
      sources: ['Local snapshot'],
    },
  ];

  const daily = buildDailyPortfolioPnlHistory(cumulative);

  assert.deepEqual(
    daily.map(({ value, positive, negative }) => ({
      value,
      positive,
      negative,
    })),
    [
      { value: 125, positive: 125, negative: 0 },
      { value: -50, positive: 0, negative: -50 },
    ],
  );
});

void test('headline P&L resets at the 00:00 UTC daily-candle boundary', () => {
  const yesterday = Date.UTC(2026, 8, 17, 23, 59);
  const today = Date.UTC(2026, 8, 18, 0, 1);
  const point = {
    timestamp: yesterday,
    value: 250,
    positive: 250,
    negative: 0,
    origin: 'local' as const,
    sources: ['Local snapshot'],
  };

  assert.equal(currentUtcDayPnl([point], today), 0);
  assert.equal(currentUtcDayPnl([{ ...point, timestamp: today }], today), 250);
});
