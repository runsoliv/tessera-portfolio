import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSparkline,
  sparklineChangePercent,
  utcDayOpenFromUniformSeries,
} from '../lib/sparklines.ts';

void test('normalizes and evenly downsamples a sparkline', () => {
  const points = normalizeSparkline(
    [0, Number.NaN, ...Array.from({ length: 100 }, (_, index) => index + 1)],
    5,
  );

  assert.deepEqual(points, [1, 26, 51, 75, 100]);
});

void test('calculates trend from the displayed endpoints', () => {
  assert.equal(sparklineChangePercent([100, 105, 110]), 10.000000000000009);
  assert.equal(sparklineChangePercent([]), null);
});

void test('selects the 00:00 UTC price from an evenly sampled series', () => {
  const end = Date.UTC(2026, 8, 18, 12);
  const hourly = Array.from({ length: 169 }, (_, index) => 100 + index);
  const open = utcDayOpenFromUniformSeries(hourly, end, 7);

  assert.deepEqual(open, {
    price: 256,
    timestamp: Date.UTC(2026, 8, 18),
  });
});
