export type SparklineSeries = {
  points: number[];
  changePercent: number | null;
  provider: string;
  range: '7D' | '5D';
  utcDayOpen?: number;
  utcDayChangePercent?: number | null;
  utcDayStart?: number;
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

export function utcDayOpenFromUniformSeries(
  values: unknown[],
  endTimestamp: number,
  rangeDays = 7,
) {
  const points = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (
    points.length < 2 ||
    !Number.isFinite(endTimestamp) ||
    !Number.isFinite(rangeDays) ||
    rangeDays <= 0
  )
    return null;

  const end = new Date(endTimestamp);
  const dayStart = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
  );
  const rangeMs = rangeDays * 86_400_000;
  const seriesStart = endTimestamp - rangeMs;
  if (dayStart < seriesStart || dayStart > endTimestamp) return null;
  const step = rangeMs / (points.length - 1);
  const index = Math.max(
    0,
    Math.min(points.length - 1, Math.round((dayStart - seriesStart) / step)),
  );
  return { price: points[index], timestamp: dayStart };
}
