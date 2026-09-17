import {
  inferPlatform,
  type Holding,
  type ImportProfile,
  type ImportProfileSource,
} from '@/lib/portfolio';

const PROFILE_SOURCES = new Set<ImportProfileSource>([
  'onchain',
  'hyperliquid',
  'lighter',
  'screenshot',
]);

export function parseImportProfiles(value: unknown): ImportProfile[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    if (!isImportProfile(candidate) || seen.has(candidate.id)) return [];
    seen.add(candidate.id);
    return [{ ...candidate, name: candidate.name.trim().slice(0, 80) }];
  });
}

export function migrateImportProfiles(
  holdings: Holding[],
  savedProfiles: ImportProfile[],
  now = Date.now(),
) {
  const profiles = parseImportProfiles(savedProfiles);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const legacyGroups = new Map<string, ImportProfile>();

  const migratedHoldings = holdings.map((holding) => {
    const source = holding.importedFrom;
    if (!source) return holding;

    if (holding.importContributions?.length) {
      for (const contribution of holding.importContributions) {
        if (profileById.has(contribution.profileId)) continue;
        const recovered = createProfile(
          profiles,
          'screenshot',
          inferPlatform(holding),
          undefined,
          holding.network,
          contribution.profileId,
          contribution.importedAt ?? holding.importedAt ?? now,
        );
        profiles.push(recovered);
        profileById.set(recovered.id, recovered);
      }
      return holding;
    }

    if (holding.importProfileId) {
      if (!profileById.has(holding.importProfileId)) {
        const recovered = createProfile(
          profiles,
          source,
          inferPlatform(holding),
          holding.walletAddress,
          holding.network,
          holding.importProfileId,
          holding.importedAt ?? now,
        );
        profiles.push(recovered);
        profileById.set(recovered.id, recovered);
      }
      return holding;
    }

    const groupKey = legacyProfileKey(
      source,
      holding.walletAddress,
      holding.network,
      inferPlatform(holding),
    );
    let profile = legacyGroups.get(groupKey);
    if (!profile) {
      profile = findMatchingProfile(
        profiles,
        source,
        holding.walletAddress,
        holding.network,
        inferPlatform(holding),
      );
      if (!profile) {
        profile = createProfile(
          profiles,
          source,
          inferPlatform(holding),
          holding.walletAddress,
          holding.network,
          undefined,
          holding.importedAt ?? now,
        );
        profiles.push(profile);
        profileById.set(profile.id, profile);
      }
      legacyGroups.set(groupKey, profile);
    }
    return { ...holding, importProfileId: profile.id };
  });

  return { holdings: migratedHoldings, profiles };
}

export function importProfileIdsForHolding(holding: Holding) {
  if (holding.importContributions?.length) {
    return Array.from(
      new Set(holding.importContributions.map((item) => item.profileId)),
    );
  }
  return holding.importProfileId ? [holding.importProfileId] : [];
}

export function holdingsForImportProfile(
  holdings: Holding[],
  profileId: string,
) {
  return holdings.flatMap((holding) => {
    const amount = holding.importContributions?.length
      ? holding.importContributions
          .filter((item) => item.profileId === profileId)
          .reduce((sum, item) => sum + item.amount, 0)
      : holding.importProfileId === profileId
        ? holding.amount
        : 0;
    if (!(amount > 0)) return [];
    const ratio = holding.amount > 0 ? amount / holding.amount : 0;
    return [
      {
        ...holding,
        id: `${holding.id}:${profileId}`,
        amount,
        marginCollateral: scaleOptional(holding.marginCollateral, ratio),
        equityOverride: scaleOptional(holding.equityOverride, ratio),
        roeBasis: scaleOptional(holding.roeBasis, ratio),
      },
    ];
  });
}

export function removeImportProfileFromHoldings(
  holdings: Holding[],
  profileId: string,
) {
  let affected = 0;
  const next = holdings.flatMap((holding) => {
    if (!holding.importContributions?.length) {
      if (holding.importProfileId !== profileId) return [holding];
      affected += 1;
      return [];
    }
    const removedAmount = holding.importContributions
      .filter((item) => item.profileId === profileId)
      .reduce((sum, item) => sum + item.amount, 0);
    if (!(removedAmount > 0)) return [holding];
    affected += 1;
    const amount = Math.max(0, holding.amount - removedAmount);
    if (!(amount > 0)) return [];
    const importContributions = holding.importContributions.filter(
      (item) => item.profileId !== profileId,
    );
    if (!importContributions.length) {
      return [
        {
          ...holding,
          amount,
          importedFrom: undefined,
          importProfileId: undefined,
          importContributions: undefined,
          importedAt: undefined,
          walletAddress: undefined,
          accountLabel:
            holding.accountLabel === 'Combined position · screenshot import'
              ? undefined
              : holding.accountLabel,
        },
      ];
    }
    return [
      {
        ...holding,
        amount,
        importContributions,
      },
    ];
  });
  return { holdings: next, affected };
}

export function retainImportProfileHoldings(
  holdings: Holding[],
  profileIds: Set<string>,
) {
  return holdings.flatMap((holding) => {
    if (!holding.importContributions?.length) {
      return holding.importProfileId && profileIds.has(holding.importProfileId)
        ? [holding]
        : [];
    }
    const importContributions = holding.importContributions.filter((item) =>
      profileIds.has(item.profileId),
    );
    const amount = importContributions.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    if (!(amount > 0)) return [];
    const ratio = holding.amount > 0 ? amount / holding.amount : 0;
    return [
      {
        ...holding,
        amount,
        importContributions,
        costBasis: undefined,
        marginCollateral: scaleOptional(holding.marginCollateral, ratio),
        equityOverride: scaleOptional(holding.equityOverride, ratio),
        roeBasis: scaleOptional(holding.roeBasis, ratio),
      },
    ];
  });
}

function scaleOptional(value: number | undefined, ratio: number) {
  return value == null ? undefined : value * ratio;
}

export function getOrCreateWalletProfile({
  profiles,
  source,
  address,
  network,
  platform,
  now = Date.now(),
}: {
  profiles: ImportProfile[];
  source: Exclude<ImportProfileSource, 'screenshot'>;
  address: string;
  network?: string;
  platform: string;
  now?: number;
}) {
  const existing = findMatchingProfile(
    profiles,
    source,
    address,
    network,
    platform,
  );
  if (existing) {
    const updated = { ...existing, lastImportedAt: now };
    return {
      profile: updated,
      profiles: profiles.map((profile) =>
        profile.id === existing.id ? updated : profile,
      ),
      created: false,
    };
  }

  const profile = createProfile(
    profiles,
    source,
    platform,
    address,
    network,
    undefined,
    now,
  );
  return { profile, profiles: [...profiles, profile], created: true };
}

export function createScreenshotProfile(
  profiles: ImportProfile[],
  platform: string,
  network?: string,
  name?: string,
  now = Date.now(),
) {
  const generated = createProfile(
    profiles,
    'screenshot',
    platform || 'Imported',
    undefined,
    network,
    undefined,
    now,
  );
  const profile = {
    ...generated,
    name: name?.trim().slice(0, 80) || generated.name,
  };
  return { profile, profiles: [...profiles, profile] };
}

function createProfile(
  profiles: ImportProfile[],
  source: ImportProfileSource,
  platform: string,
  address?: string,
  network?: string,
  id?: string,
  now = Date.now(),
): ImportProfile {
  return {
    id: id ?? createId(),
    name: nextProfileName(profiles, source, platform),
    source,
    platform: platform || sourceLabel(source),
    address: address?.trim() || undefined,
    network: network?.trim() || undefined,
    createdAt: now,
    lastImportedAt: now,
  };
}

function findMatchingProfile(
  profiles: ImportProfile[],
  source: ImportProfileSource,
  address?: string,
  network?: string,
  platform?: string,
) {
  if (source === 'screenshot') return undefined;
  const normalizedNetwork = normalize(network);
  const normalizedAddress = normalizeAddress(address, network);
  return profiles.find(
    (profile) =>
      profile.source === source &&
      normalizeAddress(profile.address, profile.network) ===
        normalizedAddress &&
      (source !== 'onchain' ||
        normalize(profile.network) === normalizedNetwork) &&
      (!normalizedAddress ||
        normalize(profile.platform) === normalize(platform)),
  );
}

function legacyProfileKey(
  source: ImportProfileSource,
  address?: string,
  network?: string,
  platform?: string,
) {
  if (source === 'screenshot') return `${source}:${normalize(platform)}`;
  return `${source}:${normalizeAddress(address, network)}:${source === 'onchain' ? normalize(network) : ''}`;
}

function nextProfileName(
  profiles: ImportProfile[],
  source: ImportProfileSource,
  platform: string,
) {
  const stem =
    source === 'screenshot'
      ? `${platform || 'Imported'} screenshot`
      : `${sourceLabel(source)} wallet`;
  const expression = new RegExp(`^${escapeRegExp(stem)} (\\d+)$`, 'i');
  const used = profiles.flatMap((profile) => {
    const match = profile.name.match(expression);
    return match ? [Number(match[1])] : [];
  });
  return `${stem} ${used.length ? Math.max(...used) + 1 : 1}`;
}

function sourceLabel(source: ImportProfileSource) {
  if (source === 'hyperliquid') return 'Hyperliquid';
  if (source === 'lighter') return 'Lighter';
  if (source === 'onchain') return 'Onchain';
  return 'Screenshot';
}

function isImportProfile(value: unknown): value is ImportProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<ImportProfile>;
  return Boolean(
    typeof profile.id === 'string' &&
    profile.id &&
    typeof profile.name === 'string' &&
    profile.name.trim() &&
    typeof profile.source === 'string' &&
    PROFILE_SOURCES.has(profile.source as ImportProfileSource) &&
    typeof profile.platform === 'string' &&
    Number.isFinite(profile.createdAt) &&
    Number.isFinite(profile.lastImportedAt),
  );
}

function normalize(value?: string) {
  return value?.trim().toLowerCase() ?? '';
}

function normalizeAddress(value?: string, network?: string) {
  const address = value?.trim() ?? '';
  return normalize(network) === 'solana' ? address : address.toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createId() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}
