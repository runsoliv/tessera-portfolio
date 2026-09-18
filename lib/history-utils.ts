import type { PortfolioSnapshot } from './portfolio.ts';

const COMPOSITION_REVERSAL_WINDOW = 3 * 86_400_000;

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
    // A wallet/profile can be removed, left out overnight, and added back on a
    // later refresh. Treat the resulting isolated V/Λ as a composition event,
    // not market performance, when the surrounding equity level reconnects.
    if (next.timestamp - previous.timestamp > COMPOSITION_REVERSAL_WINDOW)
      return true;
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

/**
 * Reconnects history segments separated by an obviously non-market step.
 * These can be left behind when an older app version restores a wallet/profile
 * without rebasing the already-saved snapshots. Work backwards from the
 * current segment so the latest, authoritative portfolio value never changes.
 */
export function repairCompositionSteps<T extends PortfolioSnapshot>(
  snapshots: T[],
) {
  const ordered = repairTransientCompositionSpikes(snapshots);
  if (ordered.length < 2) return ordered;
  const repaired = ordered.map((point) => ({ ...point }));
  let earlierOffset = 0;

  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    const point = ordered[index];
    const next = ordered[index + 1];
    const step = next.value - point.value;
    const smallerLevel = Math.max(
      100,
      Math.min(Math.abs(point.value), Math.abs(next.value)),
    );
    const abruptCompositionStep =
      Math.abs(step) >= 2_500 &&
      Math.abs(step) / smallerLevel >= 0.75;
    if (abruptCompositionStep) earlierOffset += step;
    repaired[index].value = Math.max(0, point.value + earlierOffset);
  }
  return repaired;
}
