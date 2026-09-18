export type VenueEquityReconciliation = {
  accountEquity: number;
  availableEquity: number;
  positionEquities: number[];
};

export function usableVenuePositionEquity({
  importedFrom,
  margin,
  unrealizedPnl,
  reportedEquity,
}: {
  importedFrom?: string;
  margin: number;
  unrealizedPnl: number;
  reportedEquity: number;
}) {
  const venuePosition =
    importedFrom === 'lighter' || importedFrom === 'hyperliquid';
  if (venuePosition && Number.isFinite(unrealizedPnl))
    return Math.max(0, margin + unrealizedPnl);
  if (Number.isFinite(reportedEquity) && reportedEquity >= 0)
    return reportedEquity;
  return Math.max(0, margin + unrealizedPnl);
}

/**
 * Allocates a venue-reported account equity total without manufacturing or
 * double-counting unrealized P&L.
 *
 * Lighter's total_asset_value and Hyperliquid's accountValue already include
 * unrealized P&L. Their available-balance fields are the free portion of that
 * same equity, while position margin is used only as an allocation weight.
 */
export function reconcileVenueEquity(
  reportedAccountEquity: unknown,
  reportedAvailableEquity: unknown,
  positionMarginWeights: Array<number | null | undefined>,
): VenueEquityReconciliation {
  const marginWeights = positionMarginWeights.map((value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  });
  const marginTotal = marginWeights.reduce((sum, value) => sum + value, 0);
  const accountEquityNumber = Number(reportedAccountEquity);
  const availableEquityNumber = Number(reportedAvailableEquity);
  const hasAccountEquity =
    Number.isFinite(accountEquityNumber) && accountEquityNumber >= 0;
  const rawAvailableEquity =
    Number.isFinite(availableEquityNumber) && availableEquityNumber > 0
      ? availableEquityNumber
      : 0;

  if (!hasAccountEquity) {
    return {
      accountEquity: marginTotal + rawAvailableEquity,
      availableEquity: rawAvailableEquity,
      positionEquities: marginWeights,
    };
  }

  const accountEquity = accountEquityNumber;
  const availableEquity =
    marginTotal > 0
      ? Math.min(accountEquity, rawAvailableEquity)
      : accountEquity;
  const positionEquityTotal = Math.max(0, accountEquity - availableEquity);
  const allocationScale =
    marginTotal > 0 ? positionEquityTotal / marginTotal : 0;

  return {
    accountEquity,
    availableEquity,
    positionEquities: marginWeights.map((value) => value * allocationScale),
  };
}
