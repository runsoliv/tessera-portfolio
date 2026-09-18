import type { PortfolioSnapshot } from './portfolio.ts';

export function rebasePortfolioSnapshots(
  snapshots: PortfolioSnapshot[],
  valueDelta: number,
) {
  if (!Number.isFinite(valueDelta) || Math.abs(valueDelta) < 0.005)
    return repairTransientCompositionSpikes(snapshots);
  return repairTransientCompositionSpikes(
    snapshots.map((snapshot) => ({
      ...snapshot,
      value: Math.max(0, snapshot.value + valueDelta),
    })),
  );
}

export function repairTransientCompositionSpikes<T extends PortfolioSnapshot>(
  snapshots: T[],
) {
  const ordered = Array.from(
    new Map(
      snapshots
        .filter(
          (snapshot) =>
            Number.isFinite(snapshot.timestamp) &&
            Number.isFinite(snapshot.value),
        )
        .sort((left, right) => left.timestamp - right.timestamp)
        .map((snapshot) => [snapshot.timestamp, snapshot]),
    ).values(),
  );
  if (ordered.length < 3) return ordered;
  return ordered.filter((point, index) => {
    if (index === 0 || index === ordered.length - 1) return true;
    const pointOrigin = (point as T & { origin?: string }).origin;
    if (pointOrigin && pointOrigin !== 'local') return true;
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    if (next.timestamp - previous.timestamp > 2 * 60 * 60_000) return true;
    const intoSpike = point.value - previous.value;
    const outOfSpike = next.value - point.value;
    if (intoSpike === 0 || outOfSpike === 0 || intoSpike * outOfSpike >= 0)
      return true;
    const baseline = Math.max(
      1,
      (Math.abs(previous.value) + Math.abs(next.value)) / 2,
    );
    const smallerReversal =
      Math.min(Math.abs(intoSpike), Math.abs(outOfSpike)) / baseline;
    const neighborGap = Math.abs(next.value - previous.value) / baseline;
    const pointDeviation =
      Math.abs(point.value - (previous.value + next.value) / 2) / baseline;
    return !(
      smallerReversal >= 0.075 &&
      neighborGap <= 0.12 &&
      pointDeviation >= 0.075
    );
  });
}
