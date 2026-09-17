import type { AssetOption } from '@/lib/portfolio';

export type ScreenshotAssetType = 'crypto' | 'stock';

export type DetectedScreenshotPosition = {
  id: string;
  symbol: string;
  amount: number;
  assetType: ScreenshotAssetType;
  positionType: 'spot' | 'perp';
  side: 'long' | 'short';
  leverage: number;
  totalValue?: number;
  priceEstimate?: number;
  entryPrice?: number;
  confidence: 'high' | 'review';
  evidence: string;
};

export type ScreenshotPositionImport = DetectedScreenshotPosition & {
  name: string;
  platform: string;
  network: string;
  coinId?: string;
};

export type ScreenshotImportDestination = {
  profileId?: string;
  profileName: string;
};

const IGNORED_LABELS = new Set([
  'ACCOUNT',
  'ACCOUNTS',
  'AGENTIC',
  'APY',
  'AVERAGE',
  'AVG',
  'BALANCE',
  'BALANCES',
  'BUYING',
  'CASH',
  'COLLATERAL',
  'COST',
  'CRYPTO',
  'CUSTODIAL',
  'DEPOSIT',
  'EQUITY',
  'ENTRY',
  'ETFS',
  'GOLD',
  'INCLUDES',
  'INTEREST',
  'INVESTING',
  'JOINT',
  'LIFETIME',
  'MARKET',
  'OPTIONS',
  'PAID',
  'PORTFOLIO',
  'POSITION',
  'POSITIONS',
  'PRICE',
  'SHARES',
  'STOCK',
  'STOCKS',
  'STRATEGIES',
  'TOTAL',
  'TOTALS',
  'TODAY',
  'TRADE',
  'TRADING',
  'USD',
  'VALUE',
  'WITH',
]);

export function parseScreenshotText(text: string, sourceKey = 'screenshot') {
  const lines = text
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[|]/g, ' ')
        .replace(/[‐‑‒–—]/g, '-')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
  const detected: DetectedScreenshotPosition[] = [];
  let section: ScreenshotAssetType | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/stocks?\s*(?:&|and)?\s*etfs?|brokerage/i.test(line)) {
      section = 'stock';
      continue;
    }
    if (
      /^(?:my\s+)?crypto(?:currency|currencies)?\b|offered by .*crypto/i.test(
        line,
      )
    ) {
      section = 'crypto';
      continue;
    }
    if (isNonPositionHeading(line)) {
      section = null;
      continue;
    }

    const parsedSymbol = parseSymbolLine(line);
    if (!parsedSymbol) continue;
    const block: string[] = [line];
    for (
      let cursor = index + 1;
      cursor < Math.min(lines.length, index + 9);
      cursor += 1
    ) {
      if (
        isSectionHeading(lines[cursor]) ||
        isNonPositionHeading(lines[cursor]) ||
        parseSymbolLine(lines[cursor])
      )
        break;
      block.push(lines[cursor]);
    }

    const amountResult = findAmount(block, parsedSymbol.symbol);
    if (!amountResult) continue;
    const totalValue = findDollarValue(block);
    const leverage = findLeverage(block) ?? parsedSymbol.leverage;
    const explicitPerp = block.some((item) =>
      /\b(?:perp(?:etual)?|long|short)\b/i.test(item),
    );
    const assetType: ScreenshotAssetType =
      amountResult.shares || section === 'stock' ? 'stock' : 'crypto';
    const positionType =
      assetType === 'crypto' && (leverage != null || explicitPerp)
        ? 'perp'
        : 'spot';
    const side = block.some((item) => /\bshort\b/i.test(item))
      ? 'short'
      : 'long';
    const normalizedLeverage =
      positionType === 'perp' ? Math.max(1, leverage ?? 1) : 1;
    const priceEstimate =
      totalValue && amountResult.amount
        ? totalValue / amountResult.amount
        : undefined;
    const entryPrice = findEntryPrice(block);

    detected.push({
      id: `${sourceKey}-${index}-${parsedSymbol.symbol}`,
      symbol: parsedSymbol.symbol,
      amount: amountResult.amount,
      assetType,
      positionType,
      side,
      leverage: normalizedLeverage,
      totalValue,
      priceEstimate,
      entryPrice,
      confidence:
        section || amountResult.shares || leverage != null ? 'high' : 'review',
      evidence: block.join(' · '),
    });
  }

  return dedupeDetectedPositions(detected);
}

export function dedupeDetectedPositions(items: DetectedScreenshotPosition[]) {
  const unique = new Map<string, DetectedScreenshotPosition>();
  for (const item of items) {
    const key = `${item.assetType}:${item.symbol}:${item.positionType}:${item.side}`;
    const existing = unique.get(key);
    if (!existing || completeness(item) > completeness(existing))
      unique.set(key, item);
  }
  return Array.from(unique.values());
}

export function findExactAsset(results: AssetOption[], symbol: string) {
  const expected = normalizeTicker(symbol);
  return results.find((asset) => normalizeTicker(asset.symbol) === expected);
}

export function normalizeTicker(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replaceAll('.', '-')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 12);
}

export function ocrTickerAlternatives(value: string) {
  const ticker = normalizeTicker(value);
  const variants = new Set([ticker]);
  if (/\d/.test(ticker)) {
    variants.add(ticker.replaceAll('0', 'O'));
    variants.add(ticker.replaceAll('1', 'I'));
    variants.add(ticker.replaceAll('5', 'S'));
  }
  return Array.from(variants).filter(Boolean);
}

function parseSymbolLine(line: string) {
  const cleaned = line.replace(/^[^A-Za-z0-9$]+/, '');
  const match = cleaned
    .toUpperCase()
    .match(/^\$?([A-Z][A-Z0-9.-]{0,11})(?:\s+(.*))?$/);
  if (!match) return null;
  const symbol = normalizeTicker(match[1]);
  const remainder = match[2]?.trim() ?? '';
  if (!symbol || IGNORED_LABELS.has(symbol)) return null;
  if (
    remainder &&
    !/(?:\bperp(?:etual)?\b|\blong\b|\bshort\b|\bshares?\b|\d|\$|[x×])/i.test(
      remainder,
    )
  )
    return null;
  return { symbol, leverage: findLeverage([line]) };
}

function findAmount(lines: string[], symbol: string) {
  for (const line of lines) {
    const shares = line.match(/([\dO][\dO,]*(?:[.·][\dO]+)?)\s*shares?\b/i);
    if (shares) {
      const amount = toPositiveNumber(shares[1]);
      if (amount != null) return { amount, shares: true };
    }
    if (
      /\b(?:entry|average|avg|price|value|equity|p&l|pnl|apy|today)\b/i.test(
        line,
      )
    )
      continue;
    const labeled = line.match(
      /\b(?:qty|quantity|size|amount)\s*[:=-]?\s*([\dO][\dO,]*(?:[.·][\dO]+)?)/i,
    );
    if (labeled) {
      const amount = toPositiveNumber(labeled[1]);
      if (amount != null) return { amount, shares: false };
    }
    const repeatedTicker = line.match(
      new RegExp(
        `(?:^|\\s)([\\dO][\\dO,]*(?:[.·][\\dO]+)?)\\s+${escapeRegExp(symbol)}(?:\\s|$)`,
        'i',
      ),
    );
    if (repeatedTicker) {
      const amount = toPositiveNumber(repeatedTicker[1]);
      if (amount != null) return { amount, shares: false };
    }
    const symbolFirst = line.match(
      new RegExp(
        `^\\$?${escapeRegExp(symbol)}\\s+([\\dO][\\dO,]*(?:[.·][\\dO]+)?)(?!\\s*[x×])(?:\\s|$)`,
        'i',
      ),
    );
    if (symbolFirst) {
      const amount = toPositiveNumber(symbolFirst[1]);
      if (amount != null) return { amount, shares: false };
    }
    if (line.includes('$')) continue;
    const bare = line.match(/^([\dO][\dO,]*(?:[.·][\dO]+)?)$/i);
    if (bare) {
      const amount = toPositiveNumber(bare[1]);
      if (amount != null) return { amount, shares: false };
    }
  }
  return null;
}

function findDollarValue(lines: string[]) {
  for (const line of lines) {
    if (/\b(?:entry|average|avg|cost|price|interest|p&l|pnl)\b/i.test(line))
      continue;
    const match = line.match(/\$\s*([\dO][\dO,]*(?:[.·][\dO]+)?)/i);
    const value = match ? toPositiveNumber(match[1]) : undefined;
    if (value != null) return value;
  }
  return undefined;
}

function findEntryPrice(lines: string[]) {
  for (const line of lines) {
    const match = line.match(
      /\b(?:entry|average|avg)\b[^\d$]*\$?\s*([\d][\d,]*(?:\.\d+)?)/i,
    );
    const value = match ? toPositiveNumber(match[1]) : undefined;
    if (value != null) return value;
  }
  return undefined;
}

function findLeverage(lines: string[]) {
  for (const line of lines) {
    const match = line.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*[x×](?:\s|$)/i);
    const value = match ? Number(match[1]) : undefined;
    if (value && value <= 100) return value;
  }
  return undefined;
}

function isSectionHeading(line: string) {
  return /stocks?\s*(?:&|and)?\s*etfs?|^(?:my\s+)?crypto(?:currency|currencies)?\b/i.test(
    line,
  );
}

function isNonPositionHeading(line: string) {
  return /^(?:cash\b|interest accrued\b|lifetime interest\b|cash earning\b|deposit cash\b|buying power\b|account details\b|rewards?\b)/i.test(
    line,
  );
}

function toPositiveNumber(value: string) {
  const number = Number(
    value
      .toUpperCase()
      .replaceAll('O', '0')
      .replaceAll(',', '')
      .replaceAll('·', '.'),
  );
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function completeness(item: DetectedScreenshotPosition) {
  return (
    (item.totalValue != null ? 2 : 0) +
    (item.entryPrice != null ? 2 : 0) +
    (item.confidence === 'high' ? 1 : 0)
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
