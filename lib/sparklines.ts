export type SparklineSeries = {
  points: number[];
  changePercent: number | null;
  provider: string;
  range: '7D' | '5D';
};

export function normalizeSparkline(values: unknown[], maximumPoints = 48) {
  const points = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const limit = Math.max(2, Math.floor(maximumPoints));
  if (points.length <= limit) return points;

  const lastIndex = points.length - 1;
  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round((index * lastIndex) / (limit - 1));
    return points[sourceIndex];
  });
}

export function sparklineChangePercent(points: number[]) {
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  return (last / first - 1) * 100;
}
