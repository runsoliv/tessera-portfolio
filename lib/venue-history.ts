import type {
  PortfolioSnapshot,
  VenueHistoryPoint,
  VenueHistorySeries,
} from '@/lib/portfolio';
import {
  repairCompositionSteps,
  repairTransientCompositionSpikes,
} from './history-utils.ts';

export const VENUE_HISTORY_VERSION = 3;

export type WalletHistoryPayload = Omit<VenueHistorySeries, 'profileId'>;

export type PortfolioHistoryPoint = PortfolioSnapshot & {
  origin: 'venue' | 'local';
  sources: string[];
};

export type DailyPortfolioPnlPoint = PortfolioHistoryPoint & {
  positive: number;
  negative: number;
};

export function parseVenueHistories(value: unknown): VenueHistorySeries[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is VenueHistorySeries => {
      if (!item || typeof item !== 'object') return false;
      const row = item as Partial<VenueHistorySeries>;
      return (
        typeof row.profileId === 'string' &&
        (row.source === 'hyperliquid' || row.source === 'lighter') &&
        typeof row.address === 'string' &&
        Array.isArray(row.points) &&
        Number.isFinite(row.fetchedAt)
      );
    })
    .map((series) => {
      const historyVersion = Number.isFinite(series.historyVersion)
        ? Number(series.historyVersion)
        : 1;
      const legacyLighterPnl =
        series.source === 'lighter' && historyVersion < VENUE_HISTORY_VERSION;
      return {
        ...series,
        platform:
          series.source === 'hyperliquid'
            ? ('Hyperliquid' as const)
            : ('Lighter' as const),
        points: legacyLighterPnl ? [] : cleanHistoryPoints(series.points),
        pnlPoints: cleanHistoryPoints(
          Array.isArray(series.pnlPoints)
            ? series.pnlPoints
            : series.source === 'hyperliquid'
              ? series.points.flatMap((point) =>
                  Number.isFinite(point.pnl)
                    ? [
                        {
                          timestamp: point.timestamp,
                          value: Number(point.pnl),
                        },
                      ]
                    : [],
                )
              : legacyLighterPnl
                ? series.points
                : [],
        ),
        historyVersion,
        provider:
          typeof series.provider === 'string'
            ? series.provider.slice(0, 80)
            : `${series.platform} history`,
        warning:
          typeof series.warning === 'string'
            ? series.warning.slice(0, 240)
            : undefined,
      };
    })
    .slice(0, 50);
}

export function buildPortfolioHistory(
  localSnapshots: PortfolioSnapshot[],
  venueHistories: VenueHistorySeries[],
  currentValue: number,
): PortfolioHistoryPoint[] {
  const parsedHistories = parseVenueHistories(venueHistories);
  const repairedLocal = repairTransientCompositionSpikes(
    cleanHistoryPoints(localSnapshots),
  );
  const latestSavedValue = repairedLocal.at(-1)?.value;
  const current = Number.isFinite(currentValue) ? currentValue : 0;
  // Snapshots are rebased whenever holdings are added or removed. Aligning the
  // saved curve to its current endpoint also repairs older/incomplete imports
  // that changed portfolio composition before that rebasing existed. This
  // preserves every recorded P&L delta while preventing a wallet resync from
  // appearing as a vertical gain or loss at the end of the chart.
  const endpointOffset = Number.isFinite(latestSavedValue)
    ? current - Number(latestSavedValue)
    : 0;
  const local = repairedLocal.map((point) => ({
    timestamp: point.timestamp,
    value: Math.max(0, point.value + endpointOffset),
    origin: 'local' as const,
    sources: ['Local snapshot'],
  }));
  const currentAnchor: PortfolioHistoryPoint = {
    timestamp: Date.now(),
    value: current,
    origin: 'local',
    sources: ['Current portfolio'],
  };
  const localCurve = dedupeHistoryPoints([...local, currentAnchor]);
  const pnlCurve = buildVenuePnlHistory(parsedHistories);
  if (pnlCurve.length > 1) {
    const latestPnl = pnlCurve.at(-1)?.value ?? 0;
    const venueBackfill = pnlCurve.map((point) => ({
      ...point,
      value: Math.max(0, current + point.value - latestPnl),
      sources: point.sources.map((source) => `${source} P&L`),
    }));
    return repairCompositionSteps(
      dedupeHistoryPoints([...venueBackfill, currentAnchor]),
    );
  }

  const histories = parsedHistories.filter(
    (series) => series.points.length > 1,
  );
  if (!histories.length) return repairCompositionSteps(localCurve);

  const anchor = localCurve[0];
  const sourceAtAnchor = histories.reduce(
    (sum, series) => sum + valueAt(series.points, anchor.timestamp),
    0,
  );
  const nonVenueAnchor = anchor.value - sourceAtAnchor;
  const historicalTimestamps = Array.from(
    new Set(
      histories.flatMap((series) =>
        series.points
          .filter((point) => point.timestamp < anchor.timestamp)
          .map((point) => point.timestamp),
      ),
    ),
  ).sort((left, right) => left - right);

  const backfill = historicalTimestamps.map((timestamp) => {
    const active = histories.filter(
      (series) => series.points[0]?.timestamp <= timestamp,
    );
    const venueValue = active.reduce(
      (sum, series) => sum + valueAt(series.points, timestamp),
      0,
    );
    return {
      timestamp,
      value: Math.max(0, nonVenueAnchor + venueValue),
      origin: 'venue' as const,
      sources: active.map((series) => series.platform),
    };
  });

  return repairCompositionSteps(
    dedupeHistoryPoints([...backfill, ...localCurve]),
  );
}

export function buildPortfolioPnlHistory(
  localSnapshots: PortfolioSnapshot[],
  venueHistories: VenueHistorySeries[],
  currentValue: number,
): PortfolioHistoryPoint[] {
  const equityHistory = buildPortfolioHistory(
    localSnapshots,
    venueHistories,
    currentValue,
  );
  const baseline = equityHistory[0]?.value;
  if (equityHistory.length < 2 || !Number.isFinite(baseline)) return [];
  return equityHistory.map((point) => ({
    ...point,
    value: point.value - Number(baseline),
  }));
}

export function buildDailyPortfolioPnlHistory(
  cumulativeHistory: PortfolioHistoryPoint[],
): DailyPortfolioPnlPoint[] {
  const ordered = dedupeHistoryPoints(cumulativeHistory);
  if (ordered.length < 2) return [];
  const days = new Map<string, PortfolioHistoryPoint>();
  for (const point of ordered) {
    const date = new Date(point.timestamp);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
    days.set(key, point);
  }

  let previousClose = ordered[0].value;
  return Array.from(days.values()).map((last) => {
    const value = last.value - previousClose;
    previousClose = last.value;
    return {
      timestamp: last.timestamp,
      value,
      positive: Math.max(0, value),
      negative: Math.min(0, value),
      origin: last.origin,
      sources: last.sources,
    };
  });
}

export function currentUtcDayPnl(
  dailyHistory: DailyPortfolioPnlPoint[],
  now = Date.now(),
) {
  const latest = dailyHistory.at(-1);
  if (!latest) return 0;
  const currentDate = new Date(now);
  const latestDate = new Date(latest.timestamp);
  return currentDate.getUTCFullYear() === latestDate.getUTCFullYear() &&
    currentDate.getUTCMonth() === latestDate.getUTCMonth() &&
    currentDate.getUTCDate() === latestDate.getUTCDate()
    ? latest.value
    : 0;
}

function buildVenuePnlHistory(
  venueHistories: VenueHistorySeries[],
): PortfolioHistoryPoint[] {
  const histories = parseVenueHistories(venueHistories).filter(
    (series) => (series.pnlPoints?.length ?? 0) > 1,
  );
  if (!histories.length) return [];

  const timestamps = Array.from(
    new Set(
      histories.flatMap((series) =>
        (series.pnlPoints ?? []).map((point) => point.timestamp),
      ),
    ),
  ).sort((left, right) => left - right);

  const firstValues = new Map(
    histories.map((series) => [
      series.profileId,
      series.pnlPoints?.[0]?.value ?? 0,
    ]),
  );
  const points = timestamps.map((timestamp) => {
    const active = histories.filter(
      (series) => (series.pnlPoints?.[0]?.timestamp ?? Infinity) <= timestamp,
    );
    return {
      timestamp,
      value: active.reduce(
        (sum, series) =>
          sum +
          valueAt(series.pnlPoints ?? [], timestamp) -
          (firstValues.get(series.profileId) ?? 0),
        0,
      ),
      origin: 'venue' as const,
      sources: active.map((series) => series.platform),
    };
  });
  const latest = points.at(-1);
  return latest
    ? dedupeHistoryPoints([
        ...points,
        {
          ...latest,
          timestamp: Date.now(),
        },
      ])
    : [];
}

export function historySourceLabels(histories: VenueHistorySeries[]) {
  return sourceLabels(histories, 'equity');
}

export function pnlHistorySourceLabels(histories: VenueHistorySeries[]) {
  return sourceLabels(histories, 'pnl');
}

export function cleanHistoryPoints(
  points: Array<Partial<VenueHistoryPoint | PortfolioSnapshot>>,
) {
  const cleaned = points
    .map((point) => ({
      timestamp: Number(point.timestamp),
      value: Number(point.value),
      ...('pnl' in point && Number.isFinite(Number(point.pnl))
        ? { pnl: Number(point.pnl) }
        : {}),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.timestamp) &&
        point.timestamp > 0 &&
        Number.isFinite(point.value),
    )
    .sort((left, right) => left.timestamp - right.timestamp);
  return dedupeHistoryPoints(cleaned).slice(-5_000);
}

function sourceLabels(
  histories: VenueHistorySeries[],
  metric: 'equity' | 'pnl',
) {
  return Array.from(
    new Set(
      parseVenueHistories(histories)
        .filter((series) =>
          metric === 'equity'
            ? series.points.length > 1 || (series.pnlPoints?.length ?? 0) > 1
            : (series.pnlPoints?.length ?? 0) > 1,
        )
        .map((series) => series.platform),
    ),
  );
}

function valueAt(points: VenueHistoryPoint[], timestamp: number) {
  let value = 0;
  for (const point of points) {
    if (point.timestamp > timestamp) break;
    value = point.value;
  }
  return value;
}

function dedupeHistoryPoints<T extends PortfolioSnapshot>(points: T[]): T[] {
  const byTimestamp = new Map<number, T>();
  for (const point of points) byTimestamp.set(point.timestamp, point);
  return Array.from(byTimestamp.values()).sort(
    (left, right) => left.timestamp - right.timestamp,
  );
}
