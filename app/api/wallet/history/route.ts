import type { VenueHistoryPoint } from '@/lib/portfolio';
import { cleanHistoryPoints, VENUE_HISTORY_VERSION } from '@/lib/venue-history';
import type { WalletHistoryResponse } from '@/lib/wallet-import';

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const LIGHTER_BASE_URL = 'https://mainnet.zklighter.elliot.ai';
const LIGHTER_GENESIS_SECONDS = 1_737_072_000;

export async function POST(request: Request) {
  let source: 'hyperliquid' | 'lighter';
  let address: string;
  try {
    const body = (await request.json()) as {
      source?: string;
      address?: string;
    };
    source = body.source as 'hyperliquid' | 'lighter';
    address = body.address?.trim() ?? '';
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (source !== 'hyperliquid' && source !== 'lighter') {
    return Response.json(
      { error: 'Historical data is supported for Hyperliquid and Lighter.' },
      { status: 400 },
    );
  }
  if (!EVM_ADDRESS_PATTERN.test(address)) {
    return Response.json(
      { error: 'Enter a valid 42-character EVM wallet address.' },
      { status: 400 },
    );
  }

  try {
    const history =
      source === 'hyperliquid'
        ? await hyperliquidHistory(address)
        : await lighterHistory(address);
    const response: WalletHistoryResponse = { source, address, history };
    return Response.json(response, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Venue history is currently unavailable.',
      },
      { status: 502 },
    );
  }
}

async function hyperliquidHistory(address: string) {
  const rows = await fetchJson<HyperliquidPortfolio>(
    'https://api.hyperliquid.xyz/info',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'portfolio', user: address }),
    },
  );
  const periods = new Map(rows);
  const windows = ['allTime', 'month', 'week', 'day'] as const;
  const points = mergeHistoryWindows(
    windows.map((period) =>
      cleanHistoryPoints(
        (periods.get(period)?.accountValueHistory ?? []).map(
          ([timestamp, value]) => ({
            timestamp: Number(timestamp),
            value: Number(value),
          }),
        ),
      ),
    ),
  );
  const pnlPoints = mergeAlignedPnlWindows(
    windows.map((period) =>
      cleanHistoryPoints(
        (periods.get(period)?.pnlHistory ?? []).map(([timestamp, pnl]) => ({
          timestamp: Number(timestamp),
          value: Number(pnl),
        })),
      ),
    ),
  );
  return {
    source: 'hyperliquid' as const,
    platform: 'Hyperliquid' as const,
    address,
    points,
    pnlPoints,
    fetchedAt: Date.now(),
    historyVersion: VENUE_HISTORY_VERSION,
    provider: 'Hyperliquid multi-resolution portfolio history',
    ...(!points.length
      ? { warning: 'Hyperliquid returned no historical account values.' }
      : {}),
  };
}

async function lighterHistory(address: string) {
  const accountUrl = new URL(`${LIGHTER_BASE_URL}/api/v1/account`);
  accountUrl.searchParams.set('by', 'l1_address');
  accountUrl.searchParams.set('value', address);
  accountUrl.searchParams.set('active_only', 'false');
  const accounts = await fetchJson<LighterAccounts>(accountUrl.toString());
  if (accounts.code !== 200 || !Array.isArray(accounts.accounts)) {
    throw new Error('Lighter did not return accounts for this address.');
  }

  const indexes = Array.from(
    new Set(
      accounts.accounts
        .map((account) => Number(account.account_index ?? account.index))
        .filter((index) => Number.isSafeInteger(index) && index >= 0),
    ),
  ).slice(0, 25);
  const results = await Promise.allSettled(
    indexes.map((index) => lighterAccountHistory(index)),
  );
  const accountSeries = results.flatMap((result) =>
    result.status === 'fulfilled' && result.value.length ? [result.value] : [],
  );
  const pnlPoints = aggregateLighterAccounts(accountSeries);
  const inaccessible = indexes.length - accountSeries.length;
  const warning = !pnlPoints.length
    ? 'Lighter keeps standard-account equity and P&L history behind account authorization. Positions still sync by public wallet address; local snapshots will track this venue going forward.'
    : inaccessible
      ? `${inaccessible} Lighter account${inaccessible === 1 ? '' : 's'} did not expose public P&L history.`
      : undefined;
  return {
    source: 'lighter' as const,
    platform: 'Lighter' as const,
    address,
    points: [],
    pnlPoints,
    fetchedAt: Date.now(),
    historyVersion: VENUE_HISTORY_VERSION,
    provider: 'Lighter account P&L history',
    ...(warning ? { warning } : {}),
  };
}

async function lighterAccountHistory(index: number) {
  const url = new URL(`${LIGHTER_BASE_URL}/api/v1/pnl`);
  url.searchParams.set('by', 'index');
  url.searchParams.set('value', String(index));
  url.searchParams.set('resolution', '1d');
  url.searchParams.set('start_timestamp', String(LIGHTER_GENESIS_SECONDS));
  url.searchParams.set('end_timestamp', String(Math.floor(Date.now() / 1_000)));
  url.searchParams.set('count_back', '0');
  url.searchParams.set('ignore_transfers', 'false');
  const data = await fetchJson<LighterPnl>(url.toString());
  if (data.code !== 200 || !Array.isArray(data.pnl)) return [];
  return cleanHistoryPoints(
    data.pnl.map((point) => ({
      timestamp: normalizeTimestamp(point.timestamp),
      value:
        Number(point.trade_pnl ?? 0) +
        Number(point.trade_spot_pnl ?? 0) +
        Number(point.pool_pnl ?? 0) +
        Number(point.staking_pnl ?? 0),
    })),
  );
}

function mergeHistoryWindows(windows: VenueHistoryPoint[][]) {
  return windows.reduce(
    (merged, detail) => overlayHistoryWindow(merged, detail),
    [] as VenueHistoryPoint[],
  );
}

function mergeAlignedPnlWindows(windows: VenueHistoryPoint[][]) {
  return windows.reduce((merged, detail) => {
    if (!detail.length) return merged;
    if (!merged.length) return detail;
    const detailEnd = detail.at(-1);
    if (!detailEnd) return merged;
    const anchor = historyValueAt(merged, detailEnd.timestamp);
    const offset = anchor - detailEnd.value;
    return overlayHistoryWindow(
      merged,
      detail.map((point) => ({ ...point, value: point.value + offset })),
    );
  }, [] as VenueHistoryPoint[]);
}

function overlayHistoryWindow(
  base: VenueHistoryPoint[],
  detail: VenueHistoryPoint[],
) {
  if (!detail.length) return base;
  const start = detail[0].timestamp;
  const end = detail.at(-1)?.timestamp ?? start;
  return cleanHistoryPoints([
    ...base.filter((point) => point.timestamp < start || point.timestamp > end),
    ...detail,
  ]);
}

function historyValueAt(points: VenueHistoryPoint[], timestamp: number) {
  let value = points[0]?.value ?? 0;
  for (const point of points) {
    if (point.timestamp > timestamp) break;
    value = point.value;
  }
  return value;
}

function aggregateLighterAccounts(series: VenueHistoryPoint[][]) {
  const timestamps = Array.from(
    new Set(series.flatMap((points) => points.map((point) => point.timestamp))),
  ).sort((left, right) => left - right);
  const cursors = series.map(() => 0);
  const values = series.map(() => 0);
  return timestamps.map((timestamp) => {
    series.forEach((points, seriesIndex) => {
      while (
        cursors[seriesIndex] < points.length &&
        points[cursors[seriesIndex]].timestamp <= timestamp
      ) {
        values[seriesIndex] = points[cursors[seriesIndex]].value;
        cursors[seriesIndex] += 1;
      }
    });
    return { timestamp, value: values.reduce((sum, value) => sum + value, 0) };
  });
}

function normalizeTimestamp(value: unknown) {
  const timestamp = Number(value);
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  headers.set('User-Agent', 'Tessera-Local-Portfolio/1.0');
  const response = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`History provider returned HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

type HyperliquidHistory = {
  accountValueHistory?: Array<[number | string, number | string]>;
  pnlHistory?: Array<[number | string, number | string]>;
};

type HyperliquidPortfolio = Array<[string, HyperliquidHistory]>;

type LighterAccounts = {
  code?: number;
  accounts?: Array<{ index?: number; account_index?: number }>;
};

type LighterPnl = {
  code?: number;
  pnl?: Array<{
    timestamp?: number;
    trade_pnl?: number;
    trade_spot_pnl?: number;
    pool_pnl?: number;
    staking_pnl?: number;
  }>;
};
