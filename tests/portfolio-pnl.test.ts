import assert from 'node:assert/strict';
import test from 'node:test';

import { rebasePortfolioSnapshots } from '../lib/history-utils.ts';
import {
  buildDailyPortfolioPnlHistory,
  buildPortfolioPnlHistory,
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

void test('groups cumulative performance into positive and negative daily bars', () => {
  const dayOneMorning = new Date(2026, 8, 16, 9).getTime();
  const dayOneClose = new Date(2026, 8, 16, 20).getTime();
  const dayTwoClose = new Date(2026, 8, 17, 20).getTime();
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
