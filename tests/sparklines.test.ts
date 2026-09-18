import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeSparkline,
  sparklineChangePercent,
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
