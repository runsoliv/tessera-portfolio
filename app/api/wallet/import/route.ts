import { CURATED_ASSETS } from '@/lib/portfolio';
import { reconcileVenueEquity } from '@/lib/venue-equity';
import type {
  SolanaWalletSnapshot,
  WalletImportCandidate,
  WalletImportResponse,
  WalletImportSource,
} from '@/lib/wallet-import';

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_BASE58 =
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SOLANA_RPC_URLS = [
  'https://api.mainnet.solana.com',
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
];
const SOLANA_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SOLANA_TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const SOLANA_KNOWN_TOKENS: Record<
  string,
  { name: string; symbol: string; coinId?: string; price?: number }
> = {
  So11111111111111111111111111111111111111112: {
    name: 'Wrapped SOL',
    symbol: 'WSOL',
    coinId: 'solana',
  },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    name: 'USD Coin',
    symbol: 'USDC',
    coinId: 'usd-coin',
    price: 1,
  },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
    name: 'Tether',
    symbol: 'USDT',
    coinId: 'tether',
    price: 1,
  },
};

const ONCHAIN_NETWORKS = {
  ethereum: {
    label: 'Ethereum',
    explorer: 'https://eth.blockscout.com',
    symbol: 'ETH',
    coinId: 'ethereum',
  },
  base: {
    label: 'Base',
    explorer: 'https://base.blockscout.com',
    symbol: 'ETH',
    coinId: 'ethereum',
  },
  arbitrum: {
    label: 'Arbitrum',
    explorer: 'https://arbitrum.blockscout.com',
    symbol: 'ETH',
    coinId: 'ethereum',
  },
  optimism: {
    label: 'Optimism',
    explorer: 'https://optimism.blockscout.com',
    symbol: 'ETH',
    coinId: 'ethereum',
  },
  polygon: {
    label: 'Polygon',
    explorer: 'https://polygon.blockscout.com',
    symbol: 'POL',
    coinId: 'matic-network',
  },
  gnosis: {
    label: 'Gnosis',
    explorer: 'https://gnosis.blockscout.com',
    symbol: 'XDAI',
    coinId: 'xdai',
  },
  celo: {
    label: 'Celo',
    explorer: 'https://celo.blockscout.com',
    symbol: 'CELO',
    coinId: 'celo',
  },
} as const;

type OnchainNetwork = keyof typeof ONCHAIN_NETWORKS;

export async function POST(request: Request) {
  let source: WalletImportSource;
  let address: string;
  let network: string | undefined;
  let solanaSnapshot: SolanaWalletSnapshot | undefined;
  try {
    const body = (await request.json()) as {
      source?: WalletImportSource;
      address?: string;
      network?: string;
    };
    source = body.source as WalletImportSource;
    address = body.address?.trim() ?? '';
    network = body.network;
    solanaSnapshot = parseSolanaSnapshot(
      (body as { solanaSnapshot?: unknown }).solanaSnapshot,
    );
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  if (!['onchain', 'hyperliquid', 'lighter'].includes(source)) {
    return Response.json(
      { error: 'Select a supported import source.' },
      { status: 400 },
    );
  }
  const solanaImport = source === 'onchain' && network === 'solana';
  if (
    solanaImport
      ? !isSolanaAddress(address)
      : !EVM_ADDRESS_PATTERN.test(address)
  ) {
    return Response.json(
      {
        error: solanaImport
          ? 'Enter a valid Solana wallet address.'
          : 'Enter a valid 42-character EVM wallet address.',
      },
      { status: 400 },
    );
  }

  try {
    const result =
      source === 'onchain'
        ? await importOnchain(address, network, solanaSnapshot)
        : source === 'hyperliquid'
          ? await importHyperliquid(address)
          : await importLighter(address);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'The wallet data provider did not respond.';
    return Response.json({ error: message }, { status: 502 });
  }
}

async function importOnchain(
  address: string,
  requestedNetwork?: string,
  solanaSnapshot?: SolanaWalletSnapshot,
): Promise<WalletImportResponse> {
  if (requestedNetwork === 'solana')
    return importSolana(address, solanaSnapshot);
  if (requestedNetwork === 'robinhood') return importRobinhoodChain(address);
  const network =
    requestedNetwork && requestedNetwork in ONCHAIN_NETWORKS
      ? (requestedNetwork as OnchainNetwork)
      : 'ethereum';
  const config = ONCHAIN_NETWORKS[network];
  const [addressResult, tokensResult] = await Promise.allSettled([
    fetchJson<BlockscoutAddress>(
      `${config.explorer}/api/v2/addresses/${address}`,
    ),
    fetchJson<BlockscoutTokenBalance[]>(
      `${config.explorer}/api/v2/addresses/${address}/token-balances`,
    ),
  ]);

  if (
    addressResult.status === 'rejected' &&
    tokensResult.status === 'rejected'
  ) {
    throw new Error(`${config.label} wallet data is currently unavailable.`);
  }

  const warnings: string[] = [];
  const items: WalletImportCandidate[] = [];
  if (addressResult.status === 'fulfilled') {
    const amount = fromBaseUnits(addressResult.value.coin_balance, 18);
    const price = positiveNumber(addressResult.value.exchange_rate);
    if (amount > 0) {
      items.push({
        id: `onchain:${network}:native`,
        name:
          config.symbol === 'XDAI'
            ? 'Gnosis xDAI'
            : config.symbol === 'POL'
              ? 'Polygon'
              : config.symbol === 'CELO'
                ? 'Celo'
                : 'Ethereum',
        symbol: config.symbol,
        amount,
        positionType: 'spot',
        assetClass: 'spot',
        platform: 'Self custody',
        network: config.label,
        priceSource: 'coingecko',
        provider: `Blockscout · ${config.label}`,
        price,
        estimatedValue: price ? amount * price : undefined,
        coinId: config.coinId,
      });
    }
  } else {
    warnings.push(
      'Native balance could not be read; token balances are still shown.',
    );
  }

  if (tokensResult.status === 'fulfilled') {
    for (const balance of tokensResult.value.slice(0, 250)) {
      const token = balance.token;
      if (
        !token ||
        !token.symbol ||
        !token.address_hash ||
        !String(token.type).toUpperCase().includes('ERC-20') ||
        token.reputation === 'scam'
      )
        continue;
      const decimals = Math.max(0, Math.min(36, Number(token.decimals ?? 0)));
      const amount = fromBaseUnits(balance.value, decimals);
      if (!(amount > 0)) continue;
      const symbol = cleanSymbol(token.symbol);
      if (!symbol) continue;
      const price = positiveNumber(token.exchange_rate);
      const coinId = coinIdForSymbol(symbol);
      items.push({
        id: `onchain:${network}:${token.address_hash.toLowerCase()}`,
        name: cleanName(token.name, symbol),
        symbol,
        amount,
        positionType: 'spot',
        assetClass: 'spot',
        platform: 'Self custody',
        network: config.label,
        priceSource: 'dexscreener',
        provider: `Blockscout · ${config.label}`,
        price,
        estimatedValue: price ? amount * price : undefined,
        coinId,
        address: token.address_hash,
      });
    }
  } else {
    warnings.push(
      'ERC-20 balances could not be read; the native balance is still shown.',
    );
  }

  return response('onchain', address, items, warnings, config.label);
}

async function importSolana(
  address: string,
  snapshot?: SolanaWalletSnapshot,
): Promise<WalletImportResponse> {
  const [holdingsResult, solPriceResult] = await Promise.allSettled([
    snapshot
      ? Promise.resolve<SolanaJupiterHoldings | undefined>(undefined)
      : fetchJson<SolanaJupiterHoldings>(
          `https://lite-api.jup.ag/ultra/v1/holdings/${encodeURIComponent(address)}`,
        ),
    fetchJson<Record<string, { usd?: number }>>(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    ),
  ]);

  const jupiterHoldings =
    holdingsResult.status === 'fulfilled' ? holdingsResult.value : undefined;
  const jupiterLamports = Number(jupiterHoldings?.amount);
  const balanceResult: PromiseSettledResult<SolanaBalanceResult> =
    snapshot || (Number.isFinite(jupiterLamports) && jupiterLamports >= 0)
      ? {
          status: 'fulfilled',
          value: {
            value: snapshot ? snapshot.lamports : jupiterLamports,
          },
        }
      : await settle(
          solanaRpc<SolanaBalanceResult>('getBalance', [
            address,
            { commitment: 'confirmed' },
          ]),
        );
  let assetsResult: PromiseSettledResult<SolanaDasAssetsResult | undefined> = {
    status: 'fulfilled',
    value: undefined,
  };
  if (!snapshot && holdingsResult.status === 'rejected') {
    assetsResult = await settle(
      solanaRpc<SolanaDasAssetsResult>('getAssetsByOwner', [
        {
          ownerAddress: address,
          page: 1,
          limit: 1000,
          displayOptions: {
            showFungible: true,
            showZeroBalance: false,
          },
        },
      ]),
    );
  }

  let tokenResult: PromiseSettledResult<SolanaTokenAccountsResult> = {
    status: 'fulfilled',
    value: snapshot ? snapshotToTokenAccounts(snapshot) : { value: [] },
  };
  let token2022Result: PromiseSettledResult<SolanaTokenAccountsResult> = {
    status: 'fulfilled',
    value: { value: [] },
  };
  if (
    !snapshot &&
    holdingsResult.status === 'rejected' &&
    assetsResult.status === 'rejected'
  ) {
    tokenResult = await settle(
      solanaRpc<SolanaTokenAccountsResult>('getTokenAccountsByOwner', [
        address,
        { programId: SOLANA_TOKEN_PROGRAM },
        { commitment: 'confirmed', encoding: 'jsonParsed' },
      ]),
    );
    token2022Result = await settle(
      solanaRpc<SolanaTokenAccountsResult>('getTokenAccountsByOwner', [
        address,
        { programId: SOLANA_TOKEN_2022_PROGRAM },
        { commitment: 'confirmed', encoding: 'jsonParsed' },
      ]),
    );
  }

  if (
    balanceResult.status === 'rejected' &&
    holdingsResult.status === 'rejected' &&
    assetsResult.status === 'rejected' &&
    tokenResult.status === 'rejected' &&
    token2022Result.status === 'rejected'
  ) {
    const reason = [
      balanceResult,
      holdingsResult,
      assetsResult,
      tokenResult,
      token2022Result,
    ]
      .flatMap((result) =>
        result.status === 'rejected' && result.reason instanceof Error
          ? [result.reason.message]
          : [],
      )
      .find(Boolean);
    throw new Error(
      reason
        ? `Solana wallet data is currently unavailable: ${reason}`
        : 'Solana wallet data is currently unavailable.',
    );
  }

  const warnings: string[] = [...(snapshot?.warnings ?? [])];
  const items: WalletImportCandidate[] = [];
  const solPrice =
    solPriceResult.status === 'fulfilled'
      ? positiveNumber(solPriceResult.value.solana?.usd)
      : undefined;
  const usingJupiterHoldings = Boolean(jupiterHoldings);
  const lamports = jupiterHoldings
    ? Number(jupiterHoldings.amount)
    : balanceResult.status === 'fulfilled'
      ? Number(balanceResult.value.value)
      : 0;
  const solAmount = lamports / 1_000_000_000;

  if (Number.isFinite(solAmount) && solAmount > 0) {
    items.push({
      id: 'onchain:solana:native',
      name: 'Solana',
      symbol: 'SOL',
      amount: solAmount,
      positionType: 'spot',
      assetClass: 'spot',
      platform: 'Self custody',
      network: 'Solana',
      priceSource: 'coingecko',
      provider: usingJupiterHoldings ? 'Jupiter holdings' : 'Solana RPC',
      price: solPrice,
      estimatedValue: solPrice ? solAmount * solPrice : undefined,
      coinId: 'solana',
    });
  }

  if (
    balanceResult.status === 'rejected' &&
    holdingsResult.status === 'rejected'
  ) {
    warnings.push('Native SOL balance could not be read.');
  }
  if (
    holdingsResult.status === 'rejected' &&
    assetsResult.status === 'rejected' &&
    tokenResult.status === 'rejected'
  ) {
    warnings.push('Standard SPL token balances could not be read.');
  }
  if (
    holdingsResult.status === 'rejected' &&
    assetsResult.status === 'rejected' &&
    token2022Result.status === 'rejected'
  ) {
    warnings.push('Token-2022 balances could not be read.');
  }
  if (!solPrice) {
    warnings.push(
      'The SOL preview price was unavailable and will retry after import.',
    );
  }

  const balances = new Map<
    string,
    { amount: number; name?: string; symbol?: string }
  >();
  if (holdingsResult.status === 'fulfilled' && holdingsResult.value) {
    for (const [mint, accounts] of Object.entries(
      holdingsResult.value.tokens ?? {},
    )) {
      const amount = accounts.reduce((sum, account) => {
        if (account.excludeFromNetWorth) return sum;
        const value = Number(account.uiAmountString ?? account.uiAmount);
        return Number.isFinite(value) && value > 0 ? sum + value : sum;
      }, 0);
      if (!(amount > 0)) continue;
      balances.set(mint, { amount });
    }
  } else if (assetsResult.status === 'fulfilled' && assetsResult.value) {
    for (const asset of assetsResult.value.items ?? []) {
      if (
        asset.interface !== 'FungibleToken' &&
        asset.interface !== 'FungibleAsset'
      )
        continue;
      const mint = asset.id?.trim();
      const decimals = Math.max(
        0,
        Math.min(18, Number(asset.token_info?.decimals ?? 0)),
      );
      const amount = fromBaseUnits(asset.token_info?.balance, decimals);
      if (!mint || !(amount > 0) || !Number.isFinite(amount)) continue;
      const current = balances.get(mint);
      balances.set(mint, {
        amount: (current?.amount ?? 0) + amount,
        name: cleanOptionalText(asset.content?.metadata?.name, 80),
        symbol: cleanSymbol(asset.content?.metadata?.symbol) || undefined,
      });
    }
  } else {
    const tokenAccounts = [
      ...(tokenResult.status === 'fulfilled' ? tokenResult.value.value : []),
      ...(token2022Result.status === 'fulfilled'
        ? token2022Result.value.value
        : []),
    ];
    for (const tokenAccount of tokenAccounts) {
      const info = tokenAccount.account?.data?.parsed?.info;
      const mint = info?.mint?.trim();
      const amount = Number(
        info?.tokenAmount?.uiAmountString ?? info?.tokenAmount?.uiAmount,
      );
      if (!mint || !(amount > 0) || !Number.isFinite(amount)) continue;
      const current = balances.get(mint);
      balances.set(mint, { amount: (current?.amount ?? 0) + amount });
    }
  }

  const quotes = await fetchSolanaTokenQuotes(Array.from(balances.keys()));
  if (balances.size && !quotes.size) {
    warnings.push(
      'SPL token market metadata was unavailable; token mints were still imported for review.',
    );
  }

  for (const [mint, balance] of balances) {
    const known = SOLANA_KNOWN_TOKENS[mint];
    const quote = quotes.get(mint);
    const symbol =
      cleanSymbol(
        known?.symbol ?? balance.symbol ?? quote?.baseToken?.symbol,
      ) || 'SPL';
    const name = cleanName(
      known?.name ?? balance.name ?? quote?.baseToken?.name,
      symbol,
    );
    const price = known?.price ?? positiveNumber(quote?.priceUsd);
    const coinId = known?.coinId;
    items.push({
      id: `onchain:solana:${mint}`,
      name,
      symbol,
      amount: balance.amount,
      positionType: 'spot',
      assetClass: 'spot',
      platform: 'Self custody',
      network: 'Solana',
      priceSource: coinId ? 'coingecko' : 'dexscreener',
      provider: quote
        ? `${usingJupiterHoldings ? 'Jupiter holdings' : 'Solana assets'} · DEX Screener`
        : usingJupiterHoldings
          ? 'Jupiter holdings'
          : 'Solana assets',
      price,
      estimatedValue: price ? balance.amount * price : undefined,
      coinId,
      address: mint,
      change24h: finiteOrUndefined(quote?.priceChange?.h24),
      marketCap: finiteOrUndefined(quote?.marketCap),
      volume24h: finiteOrUndefined(quote?.volume?.h24),
      liquidity: finiteOrUndefined(quote?.liquidity?.usd),
    });
  }

  return response('onchain', address, items, warnings, 'Solana');
}

async function solanaRpc<T>(method: string, params: unknown[]) {
  let lastError = 'Solana RPC did not respond.';
  for (const rpcUrl of SOLANA_RPC_URLS) {
    try {
      const rpcResponse = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: 'https://solana.com',
          'User-Agent': 'Mozilla/5.0 (compatible; Tessera-Local-Portfolio/1.0)',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!rpcResponse.ok) {
        lastError = `Solana RPC returned HTTP ${rpcResponse.status}.`;
        continue;
      }
      const payload = (await rpcResponse.json()) as SolanaRpcResponse<T>;
      if (payload.error || payload.result == null) {
        lastError = payload.error?.message || `Solana ${method} failed.`;
        continue;
      }
      return payload.result;
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

async function settle<T>(
  promise: Promise<T>,
): Promise<PromiseSettledResult<T>> {
  try {
    return { status: 'fulfilled', value: await promise };
  } catch (reason) {
    return { status: 'rejected', reason };
  }
}

function snapshotToTokenAccounts(
  snapshot: SolanaWalletSnapshot,
): SolanaTokenAccountsResult {
  return {
    value: snapshot.tokens.map((token) => ({
      account: {
        data: {
          parsed: {
            info: {
              mint: token.mint,
              tokenAmount: { uiAmountString: String(token.amount) },
            },
          },
        },
      },
    })),
  };
}

function parseSolanaSnapshot(value: unknown): SolanaWalletSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SolanaWalletSnapshot>;
  const lamports = Number(candidate.lamports);
  if (!Number.isFinite(lamports) || lamports < 0) return undefined;
  const tokens = Array.isArray(candidate.tokens)
    ? candidate.tokens.slice(0, 1000).flatMap((token) => {
        const mint = typeof token?.mint === 'string' ? token.mint.trim() : '';
        const amount = Number(token?.amount);
        return isSolanaAddress(mint) && Number.isFinite(amount) && amount > 0
          ? [{ mint, amount }]
          : [];
      })
    : [];
  const warnings = Array.isArray(candidate.warnings)
    ? candidate.warnings
        .filter((warning): warning is string => typeof warning === 'string')
        .map((warning) => warning.trim().slice(0, 160))
        .filter(Boolean)
        .slice(0, 3)
    : undefined;
  return { lamports, tokens, warnings };
}

async function fetchSolanaTokenQuotes(mints: string[]) {
  const quotes = new Map<string, SolanaDexPair>();
  const chunks: string[][] = [];
  for (let index = 0; index < mints.length; index += 30) {
    chunks.push(mints.slice(index, index + 30));
  }
  const results = await Promise.allSettled(
    chunks.map((chunk) =>
      fetchJson<SolanaDexPair[]>(
        `https://api.dexscreener.com/tokens/v1/solana/${chunk.join(',')}`,
      ),
    ),
  );
  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    for (const pair of result.value) {
      const mint = pair.baseToken?.address;
      if (!mint || !mints.includes(mint) || !positiveNumber(pair.priceUsd)) {
        continue;
      }
      const current = quotes.get(mint);
      if (
        !current ||
        Number(pair.liquidity?.usd ?? 0) > Number(current.liquidity?.usd ?? 0)
      ) {
        quotes.set(mint, pair);
      }
    }
  }
  return quotes;
}

async function importRobinhoodChain(
  address: string,
): Promise<WalletImportResponse> {
  const rpcUrl = 'https://rpc.mainnet.chain.robinhood.com';
  const metadata = await fetchJson<RobinhoodAssets>(
    'https://api.robinhood.com/rhj/assets',
  );
  const assets = (metadata.assets ?? [])
    .filter((asset) => asset.status === 'ASSET_STATUS_ACTIVE')
    .flatMap((asset) => {
      const deployment = asset.deployments?.find(
        (item) => item.chainId === 4663,
      );
      return deployment?.contractAddress
        ? [{ ...asset, contractAddress: deployment.contractAddress }]
        : [];
    })
    .slice(0, 500);

  const walletArgument = address.slice(2).toLowerCase().padStart(64, '0');
  const calls: RpcRequest[] = [
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    },
    ...assets.map((asset, index) => ({
      jsonrpc: '2.0' as const,
      id: index + 2,
      method: 'eth_call',
      params: [
        { to: asset.contractAddress, data: `0x70a08231${walletArgument}` },
        'latest',
      ],
    })),
  ];
  const rpcResults: RpcResponse[] = [];
  for (let index = 0; index < calls.length; index += 10) {
    if (index > 0) await delay(1_050);
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(calls.slice(index, index + 10)),
    } satisfies RequestInit;
    let batch: RpcResponse[];
    try {
      batch = await fetchJson<RpcResponse[]>(rpcUrl, request);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('429'))
        throw error;
      await delay(3_000);
      batch = await fetchJson<RpcResponse[]>(rpcUrl, request);
    }
    rpcResults.push(...batch);
  }
  const byId = new Map(rpcResults.map((item) => [item.id, item.result]));
  const items: WalletImportCandidate[] = [];
  const nativeAmount = unitsFromHex(byId.get(1), 18);
  if (nativeAmount > 0) {
    items.push({
      id: 'onchain:robinhood:native',
      name: 'Ethereum',
      symbol: 'ETH',
      amount: nativeAmount,
      positionType: 'spot',
      assetClass: 'spot',
      platform: 'Robinhood Chain',
      network: 'Robinhood Chain',
      priceSource: 'coingecko',
      provider: 'Robinhood Chain RPC',
      coinId: 'ethereum',
    });
  }

  const heldAssets = assets
    .map((asset, index) => ({
      asset,
      amount: unitsFromHex(
        byId.get(index + 2),
        Number(asset.tokenDecimals ?? 18),
      ),
    }))
    .filter((item) => item.amount > 0)
    .slice(0, 100);
  const warnings: string[] = [];
  const quotes = new Map<string, number>();
  const quoteResults = await Promise.allSettled(
    heldAssets.map(async ({ asset }) => {
      const data = await fetchJson<RobinhoodPrices>(
        `https://api.robinhood.com/rhj/prices/${encodeURIComponent(asset.tokenSymbol)}`,
      );
      const quote = data.quotes?.[0];
      const bid = positiveNumber(quote?.bid);
      const ask = positiveNumber(quote?.ask);
      const rawPrice = bid && ask ? (bid + ask) / 2 : (bid ?? ask);
      const multiplier = positiveNumber(asset.currentMultiplier) ?? 1;
      if (rawPrice) quotes.set(asset.tokenSymbol, rawPrice * multiplier);
    }),
  );
  if (quoteResults.some((item) => item.status === 'rejected'))
    warnings.push(
      'Some Robinhood Stock Token prices were unavailable and were imported without a current value.',
    );

  for (const { asset, amount } of heldAssets) {
    const symbol = cleanSymbol(asset.tokenSymbol);
    const price = quotes.get(asset.tokenSymbol);
    items.push({
      id: `onchain:robinhood:${asset.contractAddress.toLowerCase()}`,
      name: cleanName(asset.tokenName, symbol),
      symbol,
      amount,
      positionType: 'spot',
      assetClass: 'spot',
      platform: 'Robinhood Chain',
      network: 'Robinhood Chain',
      priceSource: 'manual',
      provider: 'Robinhood Stock Token API',
      price,
      estimatedValue: price ? amount * price : undefined,
      address: asset.contractAddress,
    });
  }
  return response('onchain', address, items, warnings, 'Robinhood Chain');
}

async function importHyperliquid(
  address: string,
): Promise<WalletImportResponse> {
  const requests = await Promise.allSettled([
    hyperInfo<HyperliquidPerpState>({
      type: 'clearinghouseState',
      user: address,
    }),
    hyperInfo<HyperliquidSpotState>({
      type: 'spotClearinghouseState',
      user: address,
    }),
    hyperInfo<HyperliquidPerpMarket>({ type: 'metaAndAssetCtxs' }),
    hyperInfo<HyperliquidSpotMarket>({ type: 'spotMetaAndAssetCtxs' }),
    hyperInfo<HyperliquidDelegatorSummary>({
      type: 'delegatorSummary',
      user: address,
    }),
    hyperInfo<HyperliquidDelegatorReward[]>({
      type: 'delegatorRewards',
      user: address,
    }),
    hyperInfo<HyperliquidWebData>({ type: 'webData2', user: address }),
    hyperInfo<string>({ type: 'userAbstraction', user: address }),
  ]);
  const [
    perpStateResult,
    spotStateResult,
    perpMarketResult,
    spotMarketResult,
    stakingResult,
    stakingRewardsResult,
    webDataResult,
    abstractionResult,
  ] = requests;
  if (
    perpStateResult.status === 'rejected' &&
    spotStateResult.status === 'rejected' &&
    stakingResult.status === 'rejected' &&
    webDataResult.status === 'rejected'
  ) {
    throw new Error('Hyperliquid wallet data is currently unavailable.');
  }

  const warnings: string[] = [];
  const items: WalletImportCandidate[] = [];
  const webData =
    webDataResult.status === 'fulfilled' ? webDataResult.value : undefined;
  const accountMode =
    abstractionResult.status === 'fulfilled'
      ? abstractionResult.value
      : undefined;
  const perpState =
    webData?.clearinghouseState ??
    (perpStateResult.status === 'fulfilled'
      ? perpStateResult.value
      : undefined);
  const spotState =
    webData?.spotState ??
    (spotStateResult.status === 'fulfilled'
      ? spotStateResult.value
      : undefined);
  const perpMarket =
    webData?.meta && webData.assetCtxs
      ? ([webData.meta, webData.assetCtxs] as HyperliquidPerpMarket)
      : perpMarketResult.status === 'fulfilled'
        ? perpMarketResult.value
        : undefined;
  const perpUniverse = perpMarket?.[0]?.universe ?? [];
  const perpContexts = perpMarket?.[1] ?? [];
  const reportedAccountValue = finiteNonNegative(
    perpState?.marginSummary?.accountValue,
  );
  const accountValue = reportedAccountValue ?? 0;
  const totalMarginUsed =
    finiteNonNegative(perpState?.marginSummary?.totalMarginUsed) ?? 0;
  const countPerpEquity =
    Boolean(webData?.spotState) || accountMode !== 'unifiedAccount';
  const hyperliquidPositionMargins = (perpState?.assetPositions ?? [])
    .filter(
      (wrapper) =>
        Math.abs(Number(wrapper.position?.szi)) > 0 &&
        Boolean(wrapper.position?.coin),
    )
    .map((wrapper) => {
      const position = wrapper.position;
      const amount = Math.abs(Number(position?.szi));
      const entryPrice = positiveNumber(position?.entryPx);
      const leverage = clamp(Number(position?.leverage?.value ?? 1), 1, 100);
      return (
        finiteNonNegative(position?.marginUsed) ??
        (entryPrice ? (amount * entryPrice) / leverage : undefined)
      );
    });
  const hyperliquidEquity = reconcileVenueEquity(
    reportedAccountValue,
    Math.max(0, accountValue - totalMarginUsed),
    hyperliquidPositionMargins,
  );
  const freePerpCollateral = countPerpEquity
    ? hyperliquidEquity.availableEquity
    : 0;
  let hyperliquidPositionIndex = 0;

  if (perpState && Array.isArray(perpState.assetPositions)) {
    for (const wrapper of perpState.assetPositions ?? []) {
      const position = wrapper.position;
      const signedSize = Number(position?.szi);
      const amount = Math.abs(signedSize);
      if (!(amount > 0) || !position?.coin) continue;
      const marketIndex = perpUniverse.findIndex(
        (asset) => asset.name === position.coin,
      );
      const marketPrice =
        marketIndex >= 0
          ? positiveNumber(
              perpContexts[marketIndex]?.markPx ??
                perpContexts[marketIndex]?.midPx,
            )
          : undefined;
      const previousPrice =
        marketIndex >= 0
          ? positiveNumber(perpContexts[marketIndex]?.prevDayPx)
          : undefined;
      const positionValuePrice = positiveNumber(position.positionValue)
        ? Math.abs(Number(position.positionValue)) / amount
        : undefined;
      const price = marketPrice ?? positionValuePrice;
      const entryPrice = positiveNumber(position.entryPx);
      const leverage = clamp(Number(position.leverage?.value ?? 1), 1, 100);
      const marginCollateral =
        positiveNumber(position.marginUsed) ??
        (entryPrice ? (amount * entryPrice) / leverage : undefined);
      const equityOverride = countPerpEquity
        ? (hyperliquidEquity.positionEquities[hyperliquidPositionIndex] ??
          marginCollateral)
        : 0;
      hyperliquidPositionIndex += 1;
      const symbol = cleanSymbol(position.coin);
      items.push({
        id: `hyperliquid:perp:${symbol}:${signedSize < 0 ? 'short' : 'long'}`,
        name: `${symbol} Perpetual`,
        symbol,
        amount,
        positionType: 'perp',
        platform: 'Hyperliquid',
        network: 'Hyperliquid',
        priceSource: 'hyperliquid',
        provider: 'Hyperliquid snapshot',
        price,
        estimatedValue: equityOverride,
        coinId: coinIdForSymbol(symbol),
        side: signedSize < 0 ? 'short' : 'long',
        leverage,
        entryPrice,
        marginMode:
          position.leverage?.type === 'isolated' ? 'isolated' : 'cross',
        marginCollateral,
        equityOverride,
        equityMarkPrice: price,
        roeBasis: entryPrice ? (amount * entryPrice) / leverage : undefined,
        reportedRoe:
          finiteNumber(position.returnOnEquity) != null
            ? Number(position.returnOnEquity) * 100
            : undefined,
        reportedUnrealizedPnl: finiteNumber(position.unrealizedPnl),
        liquidationModel: 'reported-only',
        maintenanceMarginRate: positiveNumber(position.maxLeverage)
          ? 50 / Number(position.maxLeverage)
          : 0.5,
        reportedLiquidationPrice: positiveNumber(position.liquidationPx),
        marketRef: position.coin,
        accountMode,
        accountLabel: accountModeLabel(accountMode),
        change24h:
          price && previousPrice ? (price / previousPrice - 1) * 100 : null,
        volume24h: finiteOrUndefined(perpContexts[marketIndex]?.dayNtlVlm),
      });
    }
  } else {
    warnings.push('Perpetual positions could not be read.');
  }

  const spotMarket =
    spotMarketResult.status === 'fulfilled'
      ? spotMarketResult.value
      : undefined;
  const spotMeta = spotMarket?.[0];
  const spotContexts = spotMarket?.[1] ?? [];
  let freeCollateralAssigned = false;
  if (spotState && Array.isArray(spotState.balances)) {
    for (const balance of spotState.balances ?? []) {
      const baseAmount = Number(balance.total);
      const isUsdc =
        cleanSymbol(balance.coin) === 'USDC' || Number(balance.token) === 0;
      const amount = baseAmount + (isUsdc ? freePerpCollateral : 0);
      if (!(amount > 0)) continue;
      const tokenIndex = Number(balance.token);
      const token = spotMeta?.tokens?.find((item) => item.index === tokenIndex);
      const symbol = cleanSymbol(token?.name ?? balance.coin);
      if (!symbol || symbol.startsWith('+')) continue;
      const pair = spotMeta?.universe?.find(
        (item) => item.tokens?.[0] === tokenIndex && item.tokens?.[1] === 0,
      );
      const marketContext = pair?.name
        ? spotContexts.find((context) => context.coin === pair.name)
        : undefined;
      const marketPrice = positiveNumber(
        marketContext?.markPx ?? marketContext?.midPx,
      );
      const price = symbol === 'USDC' ? 1 : marketPrice;
      const entryNotional = positiveNumber(balance.entryNtl);
      const coinId = coinIdForSymbol(symbol);
      if (isUsdc) freeCollateralAssigned = true;
      items.push({
        id: `hyperliquid:spot:${tokenIndex}:${symbol}`,
        name: cleanName(token?.fullName, symbol),
        symbol,
        amount,
        positionType: 'spot',
        assetClass: 'spot',
        platform: 'Hyperliquid',
        network: 'Hyperliquid',
        priceSource: symbol === 'USDC' ? 'coingecko' : 'hyperliquid',
        provider: 'Hyperliquid snapshot',
        price,
        estimatedValue: price ? amount * price : undefined,
        coinId,
        costBasis: entryNotional ? entryNotional / amount : undefined,
        collateralEligible:
          isUsdc ||
          accountMode === 'unifiedAccount' ||
          accountMode === 'portfolioMargin',
        marketRef: pair?.name,
        accountMode,
        accountLabel: accountModeLabel(accountMode),
        change24h:
          price && positiveNumber(marketContext?.prevDayPx)
            ? (price / Number(marketContext?.prevDayPx) - 1) * 100
            : null,
        marketCap:
          price && positiveNumber(marketContext?.circulatingSupply)
            ? price * Number(marketContext?.circulatingSupply)
            : null,
        volume24h: finiteOrUndefined(marketContext?.dayNtlVlm),
      });
    }
  } else {
    warnings.push('Spot balances could not be read.');
  }

  if (freePerpCollateral > 0 && !freeCollateralAssigned) {
    items.push({
      id: 'hyperliquid:spot:0:USDC',
      name: 'USD Coin',
      symbol: 'USDC',
      amount: freePerpCollateral,
      positionType: 'spot',
      assetClass: 'spot',
      platform: 'Hyperliquid',
      network: 'Hyperliquid',
      priceSource: 'coingecko',
      provider: 'Hyperliquid available collateral',
      price: 1,
      estimatedValue: freePerpCollateral,
      coinId: 'usd-coin',
      collateralEligible: true,
      accountMode,
      accountLabel: accountModeLabel(accountMode),
    });
  }

  if (stakingResult.status === 'fulfilled') {
    const hypeToken = spotMeta?.tokens?.find(
      (token) => cleanSymbol(token.name) === 'HYPE',
    );
    const hypePair = hypeToken
      ? spotMeta?.universe?.find(
          (pair) =>
            pair.tokens?.[0] === hypeToken.index && pair.tokens?.[1] === 0,
        )
      : undefined;
    const hypeContext = hypePair?.name
      ? spotContexts.find((context) => context.coin === hypePair.name)
      : undefined;
    const hypePrice = positiveNumber(hypeContext?.markPx ?? hypeContext?.midPx);
    const stakingRows: Array<{
      key: string;
      name: string;
      amount: number;
      assetClass: 'staked' | 'staking' | 'unstaking';
    }> = [
      {
        key: 'delegated',
        name: 'Staked Hyperliquid',
        amount: Number(stakingResult.value.delegated),
        assetClass: 'staked',
      },
      {
        key: 'undelegated',
        name: 'HYPE staking balance',
        amount: Number(stakingResult.value.undelegated),
        assetClass: 'staking',
      },
      {
        key: 'pending',
        name: 'HYPE pending withdrawal',
        amount: Number(stakingResult.value.totalPendingWithdrawal),
        assetClass: 'unstaking',
      },
    ];
    const allTimeStakingRewards =
      stakingRewardsResult.status === 'fulfilled'
        ? stakingRewardsResult.value.reduce((sum, reward) => {
            const amount = Number(reward.totalAmount);
            return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
          }, 0)
        : undefined;
    const rewardsRowKey = stakingRows.find((row) => row.amount > 0)?.key;
    for (const row of stakingRows) {
      if (!(row.amount > 0)) continue;
      items.push({
        id: `hyperliquid:staking:${row.key}:HYPE`,
        name: row.name,
        symbol: 'HYPE',
        amount: row.amount,
        positionType: 'spot',
        assetClass: row.assetClass,
        platform: 'Hyperliquid',
        network: 'Hyperliquid',
        priceSource: hypePair?.name ? 'hyperliquid' : 'coingecko',
        provider: 'Hyperliquid staking snapshot',
        coinId: 'hyperliquid',
        collateralEligible: false,
        price: hypePrice,
        estimatedValue: hypePrice ? row.amount * hypePrice : undefined,
        marketRef: hypePair?.name,
        accountMode,
        accountLabel: accountModeLabel(accountMode),
        change24h:
          hypePrice && positiveNumber(hypeContext?.prevDayPx)
            ? (hypePrice / Number(hypeContext?.prevDayPx) - 1) * 100
            : null,
        marketCap:
          hypePrice && positiveNumber(hypeContext?.circulatingSupply)
            ? hypePrice * Number(hypeContext?.circulatingSupply)
            : null,
        volume24h: finiteOrUndefined(hypeContext?.dayNtlVlm),
        stakingRewardsAmount:
          row.key === rewardsRowKey ? allTimeStakingRewards : undefined,
        stakingRewardsSource:
          row.key === rewardsRowKey && allTimeStakingRewards != null
            ? 'reported'
            : undefined,
      });
    }
    if (stakingRewardsResult.status === 'rejected')
      warnings.push(
        'Hyperliquid all-time staking rewards were unavailable; the staked balance was still imported.',
      );
  } else {
    warnings.push('Staked HYPE balances could not be read.');
  }

  if (!perpMarket || !spotMarket) {
    warnings.push(
      'Some market prices were unavailable; saved price providers will resolve supported symbols after import.',
    );
  }
  if (accountMode === 'unifiedAccount' && !webData?.spotState) {
    warnings.push(
      'Unified-account spot separation was unavailable; per-position equity was excluded to avoid double-counting collateral.',
    );
  }
  return response('hyperliquid', address, items, warnings, 'Hyperliquid');
}

async function importLighter(address: string): Promise<WalletImportResponse> {
  const mainnetUrl = 'https://mainnet.zklighter.elliot.ai';
  const robinhoodUrl = 'https://api.rh.lighter.xyz';
  const accountUrl = (baseUrl: string) => {
    const url = new URL(`${baseUrl}/api/v1/account`);
    url.searchParams.set('by', 'l1_address');
    url.searchParams.set('value', address);
    url.searchParams.set('active_only', 'true');
    return url.toString();
  };
  let data = await fetchJson<LighterResponse>(accountUrl(mainnetUrl)).catch(
    (error: unknown) => {
      // Lighter returns HTTP 400 with code 21100 for an unknown L1 address.
      if (error instanceof Error && error.message.includes('HTTP 400'))
        return { code: 21100 } as LighterResponse;
      throw error;
    },
  );
  const robinhood =
    data.code === 21100 || (data.code === 200 && !data.accounts?.length);
  if (robinhood)
    data = await fetchJson<LighterResponse>(accountUrl(robinhoodUrl)).catch(
      (error: unknown) => {
        if (error instanceof Error && error.message.includes('HTTP 400'))
          return { code: 21100 } as LighterResponse;
        throw error;
      },
    );
  if (
    data.code !== 200 ||
    !Array.isArray(data.accounts) ||
    !data.accounts.length
  )
    throw new Error(
      'No Lighter or Robinhood Lighter account was found for this address.',
    );

  const baseUrl = robinhood ? robinhoodUrl : mainnetUrl;
  const venueName = robinhood ? 'Robinhood Lighter' : 'Lighter';
  const stableSymbol = robinhood ? 'USDG' : 'USDC';
  const [stakingPools, marketDetails] = await Promise.all([
    robinhood
      ? Promise.resolve({ code: 200, public_pools: [] } as LighterPoolsResponse)
      : fetchJson<LighterPoolsResponse>(
          `${baseUrl}/api/v1/publicPoolsMetadata?index=9007199254740991&limit=100&filter=stake`,
        ).catch(() => ({ code: 0, public_pools: [] })),
    fetchJson<LighterMarketResponse>(
      `${baseUrl}/api/v1/orderBookDetails`,
    ).catch(() => ({ code: 0, order_book_details: [] })),
  ]);

  const warnings: string[] = [];
  if (data.accounts.some((account) => !Array.isArray(account.positions)))
    warnings.push(`${venueName} perpetual positions could not be read.`);
  if (data.accounts.some((account) => !Array.isArray(account.assets)))
    warnings.push(`${venueName} spot balances could not be read.`);
  if (!robinhood && !stakingPools.public_pools?.length)
    warnings.push(
      'Lighter staking metadata was unavailable, so staked LIT may not be included in this snapshot.',
    );
  const items: WalletImportCandidate[] = [];
  const spotBalances = new Map<
    string,
    {
      amount: number;
      name: string;
      coinId?: string;
      collateralEligible: boolean;
    }
  >();
  const perpMarkets = new Map(
    (marketDetails.order_book_details ?? []).map((market) => [
      Number(market.market_id),
      market,
    ]),
  );
  const lighterTokenPrice = positiveNumber(
    (marketDetails.order_book_details ?? []).find(
      (market) =>
        String(market.symbol ?? '')
          .toUpperCase()
          .trim() === 'LIT',
    )?.mark_price,
  );
  const stakingBalances = new Map<
    number,
    { amount: number; principal: number; entryUsdc: number }
  >();
  let pendingLighter = 0;
  let availableUsdc = 0;
  for (const account of data.accounts.slice(0, 100)) {
    const accountIndex = String(
      account.index ?? account.account_index ?? 'main',
    );
    const accountPositions = (account.positions ?? []).filter(
      (position) =>
        Math.abs(Number(position.position)) > 0 && Boolean(position.symbol),
    );
    const accountPositionMargins = accountPositions.map((position) => {
      const amount = Math.abs(Number(position.position));
      const entryPrice = positiveNumber(position.avg_entry_price);
      const positionValue = Math.abs(Number(position.position_value ?? 0));
      const initialMarginFraction = positiveNumber(
        position.initial_margin_fraction,
      );
      const leverage = initialMarginFraction
        ? clamp(100 / initialMarginFraction, 1, 100)
        : 1;
      return (
        positiveNumber(position.allocated_margin) ??
        (positionValue > 0
          ? positionValue / leverage
          : entryPrice
            ? (amount * entryPrice) / leverage
            : undefined)
      );
    });
    const accountEquity = reconcileVenueEquity(
      finiteNonNegative(account.total_asset_value),
      finiteNonNegative(account.available_balance),
      accountPositionMargins,
    );
    availableUsdc += accountEquity.availableEquity;
    for (const asset of account.assets ?? []) {
      const symbol = cleanSymbol(asset.symbol);
      const amount = Number(asset.balance);
      if (!symbol || symbol === stableSymbol || !(amount > 0)) continue;
      // Margin-enabled assets are already represented in the account's USD
      // equity and available balance. Importing them again would double-count
      // the same collateral. Disabled balances remain standalone spot assets.
      if (asset.margin_mode === 'enabled') continue;
      const current = spotBalances.get(symbol);
      spotBalances.set(symbol, {
        amount: (current?.amount ?? 0) + amount,
        name: current?.name ?? assetName(symbol),
        coinId: current?.coinId ?? coinIdForSymbol(symbol),
        collateralEligible:
          (current?.collateralEligible ?? true) &&
          asset.margin_mode === 'enabled',
      });
    }

    for (const share of account.shares ?? []) {
      const poolIndex = Number(share.public_pool_index);
      const pool = stakingPools.public_pools?.find(
        (item) => Number(item.account_index) === poolIndex,
      );
      const totalShares = Number(pool?.total_shares);
      const shares = Number(share.shares_amount);
      const stakedAsset = pool?.assets?.find(
        (asset) => cleanSymbol(asset.symbol) === 'LIT',
      );
      const poolLit = Number(stakedAsset?.balance);
      const principal = Number(share.principal_amount);
      const entryUsdc = Number(share.entry_usdc);
      const amount =
        totalShares > 0 && shares > 0 && poolLit > 0
          ? (shares / totalShares) * poolLit
          : principal;
      if (amount > 0 && Number.isFinite(amount)) {
        const current = stakingBalances.get(poolIndex);
        stakingBalances.set(poolIndex, {
          amount: (current?.amount ?? 0) + amount,
          principal:
            (current?.principal ?? 0) +
            (Number.isFinite(principal) && principal > 0 ? principal : 0),
          entryUsdc:
            (current?.entryUsdc ?? 0) +
            (Number.isFinite(entryUsdc) && entryUsdc > 0 ? entryUsdc : 0),
        });
      }
    }
    for (const pending of account.pending_unlocks ?? []) {
      if (Number(pending.asset_index) !== 2) continue;
      const amount = Number(pending.amount);
      if (amount > 0 && Number.isFinite(amount)) pendingLighter += amount;
    }

    for (const [positionIndex, position] of accountPositions.entries()) {
      const signedAmount = Number(position.position);
      const amount = Math.abs(signedAmount);
      if (!(amount > 0) || !position.symbol) continue;
      const symbol = cleanSymbol(position.symbol);
      const side =
        Number(position.sign) < 0 || signedAmount < 0 ? 'short' : 'long';
      const entryPrice = positiveNumber(position.avg_entry_price);
      const positionValue = Math.abs(Number(position.position_value ?? 0));
      const market = perpMarkets.get(Number(position.market_id));
      const price =
        positiveNumber(market?.mark_price) ??
        (positionValue > 0 ? positionValue / amount : entryPrice);
      const initialMarginFraction = positiveNumber(
        position.initial_margin_fraction,
      );
      const leverage = initialMarginFraction
        ? clamp(100 / initialMarginFraction, 1, 100)
        : 1;
      const allocated = positiveNumber(position.allocated_margin);
      const marginCollateral =
        allocated ?? (positionValue > 0 ? positionValue / leverage : undefined);
      const equityOverride =
        accountEquity.positionEquities[positionIndex] ?? marginCollateral;
      const coinId = coinIdForSymbol(symbol);
      items.push({
        id: `lighter:perp:${accountIndex}:${position.market_id}:${side}`,
        name: `${symbol} Perpetual`,
        symbol,
        amount,
        positionType: 'perp',
        platform: 'Lighter',
        network: `${venueName} · #${accountIndex}`,
        priceSource: 'lighter',
        provider: `${venueName} snapshot`,
        price,
        estimatedValue: equityOverride,
        coinId,
        side,
        leverage,
        entryPrice,
        marginMode: Number(position.margin_mode) === 1 ? 'isolated' : 'cross',
        marginCollateral,
        equityOverride,
        equityMarkPrice: price,
        reportedUnrealizedPnl: finiteNumber(position.unrealized_pnl),
        liquidationModel: 'reported-only',
        maintenanceMarginRate:
          finiteNonNegative(market?.maintenance_margin_fraction) != null
            ? Number(market?.maintenance_margin_fraction) / 100
            : 0.5,
        reportedLiquidationPrice: positiveNumber(position.liquidation_price),
        accountLabel: `Account ${accountIndex}`,
        marketRef: String(position.market_id),
        change24h: finiteNumber(market?.daily_price_change) ?? null,
        volume24h: finiteOrUndefined(market?.daily_quote_token_volume),
      });
    }
  }

  if (availableUsdc > 0) {
    spotBalances.set(stableSymbol, {
      amount: availableUsdc,
      name: robinhood ? 'USDG' : 'USD Coin',
      coinId: robinhood ? undefined : 'usd-coin',
      collateralEligible: true,
    });
  }
  for (const [symbol, balance] of spotBalances) {
    const price = symbol === stableSymbol ? 1 : undefined;
    items.push({
      id: `lighter:spot:${symbol}`,
      name: balance.name,
      symbol,
      amount: balance.amount,
      positionType: 'spot',
      assetClass: 'spot',
      platform: 'Lighter',
      network: venueName,
      priceSource:
        symbol === 'LIT' ? 'lighter' : balance.coinId ? 'coingecko' : 'manual',
      provider: `${venueName} snapshot`,
      price,
      estimatedValue: price ? balance.amount * price : undefined,
      coinId: balance.coinId,
      collateralEligible: balance.collateralEligible,
    });
  }

  for (const [poolIndex, balance] of stakingBalances) {
    const stakingRewardsAmount = Math.max(
      0,
      balance.amount - balance.principal,
    );
    items.push({
      id: `lighter:staking:${poolIndex}:LIT`,
      name: 'Staked Lighter',
      symbol: 'LIT',
      amount: balance.amount,
      positionType: 'spot',
      assetClass: 'staked',
      platform: 'Lighter',
      network: 'Lighter',
      priceSource: 'lighter',
      provider: 'Lighter staking snapshot',
      coinId: 'lighter',
      collateralEligible: false,
      price: lighterTokenPrice,
      estimatedValue: lighterTokenPrice
        ? balance.amount * lighterTokenPrice
        : undefined,
      costBasis:
        balance.entryUsdc > 0 ? balance.entryUsdc / balance.amount : undefined,
      stakingPrincipalAmount:
        balance.principal > 0 ? balance.principal : undefined,
      stakingRewardsAmount:
        balance.principal > 0 ? stakingRewardsAmount : undefined,
      stakingRewardsSource: balance.principal > 0 ? 'derived' : undefined,
    });
  }
  if (pendingLighter > 0) {
    items.push({
      id: 'lighter:staking:pending:LIT',
      name: 'LIT pending unlock',
      symbol: 'LIT',
      amount: pendingLighter,
      positionType: 'spot',
      assetClass: 'unstaking',
      platform: 'Lighter',
      network: 'Lighter',
      priceSource: 'lighter',
      provider: 'Lighter staking snapshot',
      coinId: 'lighter',
      collateralEligible: false,
      price: lighterTokenPrice,
      estimatedValue: lighterTokenPrice
        ? pendingLighter * lighterTokenPrice
        : undefined,
    });
  }

  if (data.accounts.length > 1)
    warnings.push(
      `Combined spot balances from ${data.accounts.length} ${venueName} accounts. Perpetuals remain separated by account.`,
    );
  return response('lighter', address, items, warnings, venueName);
}

function response(
  source: WalletImportSource,
  address: string,
  candidates: WalletImportCandidate[],
  warnings: string[],
  network?: string,
): WalletImportResponse {
  const items = candidates
    .filter((item) => item.amount > 0 && Number.isFinite(item.amount))
    .sort(
      (a, b) => Number(b.estimatedValue ?? 0) - Number(a.estimatedValue ?? 0),
    )
    .slice(0, 150);
  return { source, address, network, items, warnings, fetchedAt: Date.now() };
}

async function hyperInfo<T>(body: Record<string, unknown>) {
  return fetchJson<T>('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  headers.set('User-Agent', 'Tessera-Local-Portfolio/1.0');
  const response = await fetch(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok)
    throw new Error(`Provider returned HTTP ${response.status}.`);
  return response.json() as Promise<T>;
}

function coinIdForSymbol(input: string) {
  const symbol = input.toUpperCase();
  const aliases: Record<string, string> = {
    ETH: 'ethereum',
    WETH: 'ethereum',
    BTC: 'bitcoin',
    WBTC: 'bitcoin',
    UBTC: 'bitcoin',
    USDC: 'usd-coin',
    USDT: 'tether',
    XDAI: 'xdai',
    POL: 'matic-network',
    MATIC: 'matic-network',
    HYPE: 'hyperliquid',
    LIT: 'lighter',
  };
  return (
    aliases[symbol] ??
    CURATED_ASSETS.find((asset) => asset.symbol.toUpperCase() === symbol)?.id
  );
}

function assetName(symbol: string) {
  return (
    CURATED_ASSETS.find((asset) => asset.symbol.toUpperCase() === symbol)
      ?.name ?? symbol
  );
}

function cleanName(input: unknown, fallback: string) {
  const value =
    typeof input === 'string'
      ? Array.from(input.trim())
          .filter((character) => character.charCodeAt(0) >= 32)
          .join('')
      : '';
  return (value || assetName(fallback)).slice(0, 80);
}

function cleanOptionalText(input: unknown, maxLength: number) {
  if (typeof input !== 'string') return undefined;
  const value = Array.from(input.trim())
    .filter((character) => character.charCodeAt(0) >= 32)
    .join('')
    .slice(0, maxLength);
  return value || undefined;
}

function cleanSymbol(input: unknown) {
  const value =
    typeof input === 'string' || typeof input === 'number' ? String(input) : '';
  return value
    .trim()
    .replace(/[^a-zA-Z0-9+._-]/g, '')
    .toUpperCase()
    .slice(0, 18);
}

function fromBaseUnits(value: unknown, decimals: number) {
  const number = Number(value);
  const amount = number / 10 ** decimals;
  return Number.isFinite(amount) ? amount : 0;
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function finiteNonNegative(value: unknown) {
  const number = finiteNumber(value);
  return number != null && number >= 0 ? number : undefined;
}

function finiteOrUndefined(value: unknown) {
  return finiteNumber(value);
}

function accountModeLabel(mode: string | undefined) {
  if (mode === 'unifiedAccount') return 'Unified account';
  if (mode === 'portfolioMargin') return 'Portfolio margin';
  return mode ? 'Standard account' : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isSolanaAddress(address: string) {
  if (address.length < 32 || address.length > 44) return false;
  const bytes = [0];
  for (const character of address) {
    let carry = SOLANA_BASE58.indexOf(character);
    if (carry < 0) return false;
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
      const value = bytes[index] * 58 + carry;
      bytes[index] = value & 255;
      carry = value >> 8;
    }
    while (carry > 0) {
      bytes.unshift(carry & 255);
      carry >>= 8;
    }
  }
  let leadingZeroBytes = 0;
  while (address[leadingZeroBytes] === '1') leadingZeroBytes += 1;
  const decodedBytes = bytes.length === 1 && bytes[0] === 0 ? 0 : bytes.length;
  return decodedBytes + leadingZeroBytes === 32;
}

type BlockscoutAddress = {
  coin_balance?: string;
  exchange_rate?: string | number | null;
};
type BlockscoutTokenBalance = {
  value?: string;
  token?: {
    address_hash?: string;
    decimals?: string | number | null;
    exchange_rate?: string | number | null;
    name?: string;
    reputation?: string;
    symbol?: string;
    type?: string;
  };
};

type HyperliquidPosition = {
  coin?: string;
  entryPx?: string;
  leverage?: { type?: string; value?: number };
  liquidationPx?: string | null;
  marginUsed?: string;
  maxLeverage?: number;
  positionValue?: string;
  returnOnEquity?: string;
  unrealizedPnl?: string;
  szi?: string;
};
type HyperliquidPerpState = {
  assetPositions?: Array<{ position?: HyperliquidPosition }>;
  marginSummary?: { accountValue?: string; totalMarginUsed?: string };
  crossMarginSummary?: { accountValue?: string; totalMarginUsed?: string };
  crossMaintenanceMarginUsed?: string;
  withdrawable?: string;
};
type HyperliquidSpotState = {
  balances?: Array<{
    coin?: string;
    token?: number;
    total?: string;
    hold?: string;
    entryNtl?: string;
  }>;
};
type HyperliquidPerpMeta = { universe?: Array<{ name?: string }> };
type HyperliquidPerpContext = {
  markPx?: string;
  midPx?: string;
  prevDayPx?: string;
  dayNtlVlm?: string;
};
type HyperliquidPerpMarket = [HyperliquidPerpMeta, HyperliquidPerpContext[]];
type HyperliquidSpotMarket = [
  {
    tokens?: Array<{ index?: number; name?: string; fullName?: string | null }>;
    universe?: Array<{ name?: string; tokens?: number[] }>;
  },
  Array<{
    coin?: string;
    markPx?: string;
    midPx?: string;
    prevDayPx?: string;
    dayNtlVlm?: string;
    circulatingSupply?: string;
  }>,
];
type HyperliquidWebData = {
  clearinghouseState?: HyperliquidPerpState;
  spotState?: HyperliquidSpotState;
  meta?: HyperliquidPerpMeta;
  assetCtxs?: HyperliquidPerpContext[];
};
type HyperliquidDelegatorSummary = {
  delegated?: string;
  undelegated?: string;
  totalPendingWithdrawal?: string;
  nPendingWithdrawals?: number;
};
type HyperliquidDelegatorReward = {
  time?: number;
  source?: string;
  totalAmount?: string;
};

type LighterPosition = {
  market_id?: number;
  symbol?: string;
  sign?: number;
  position?: string;
  avg_entry_price?: string;
  position_value?: string;
  liquidation_price?: string;
  margin_mode?: number;
  allocated_margin?: string;
  initial_margin_fraction?: string;
  unrealized_pnl?: string;
};
type LighterAccount = {
  index?: number;
  account_index?: number;
  available_balance?: string;
  collateral?: string;
  total_asset_value?: string;
  cross_asset_value?: string;
  cross_initial_margin_requirement?: string;
  cross_maintenance_margin_requirement?: string;
  positions?: LighterPosition[];
  assets?: Array<{
    symbol?: string;
    asset_id?: number;
    balance?: string;
    margin_mode?: string;
  }>;
  shares?: Array<{
    public_pool_index?: number;
    shares_amount?: number;
    principal_amount?: string;
    entry_usdc?: string;
    entry_timestamp?: number;
  }>;
  pending_unlocks?: Array<{
    asset_index?: number;
    amount?: string;
    unlock_timestamp?: number;
  }>;
};
type LighterResponse = { code?: number; accounts?: LighterAccount[] };
type LighterPoolsResponse = {
  code?: number;
  public_pools?: Array<{
    account_index?: number;
    total_shares?: number;
    assets?: Array<{ symbol?: string; balance?: string }>;
  }>;
};
type LighterMarketResponse = {
  code?: number;
  order_book_details?: Array<{
    market_id?: number;
    symbol?: string;
    mark_price?: string;
    maintenance_margin_fraction?: number;
    daily_price_change?: number;
    daily_quote_token_volume?: number;
  }>;
};

type RpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
};
type RpcResponse = { id: number; result?: string };
type RobinhoodAssets = {
  assets?: Array<{
    tokenSymbol: string;
    tokenName?: string;
    tokenDecimals?: number;
    currentMultiplier?: string;
    status?: string;
    deployments?: Array<{ chainId?: number; contractAddress?: string }>;
  }>;
};
type RobinhoodPrices = { quotes?: Array<{ bid?: string; ask?: string }> };

type SolanaRpcResponse<T> = {
  result?: T;
  error?: { code?: number; message?: string };
};
type SolanaBalanceResult = { value: number };
type SolanaJupiterHoldings = {
  amount?: string;
  uiAmount?: number;
  uiAmountString?: string;
  tokens?: Record<
    string,
    Array<{
      amount?: string;
      uiAmount?: number;
      uiAmountString?: string;
      decimals?: number;
      programId?: string;
      excludeFromNetWorth?: boolean;
    }>
  >;
};
type SolanaDasAssetsResult = {
  total?: number;
  items?: Array<{
    interface?: string;
    id?: string;
    content?: {
      metadata?: { name?: string; symbol?: string; token_standard?: string };
    };
    token_info?: {
      balance?: string | number;
      decimals?: number;
      token_program?: string;
    };
  }>;
};
type SolanaTokenAccountsResult = {
  value: Array<{
    account?: {
      data?: {
        parsed?: {
          info?: {
            mint?: string;
            tokenAmount?: {
              amount?: string;
              decimals?: number;
              uiAmount?: number | null;
              uiAmountString?: string;
            };
          };
        };
      };
    };
  }>;
};
type SolanaDexPair = {
  baseToken?: { address?: string; name?: string; symbol?: string };
  priceUsd?: string | null;
  priceChange?: { h24?: number | null };
  marketCap?: number | null;
  volume?: { h24?: number | null };
  liquidity?: { usd?: number | null };
};

function unitsFromHex(value: string | undefined, decimals: number) {
  if (!value || !/^0x[0-9a-f]+$/i.test(value)) return 0;
  try {
    const raw = BigInt(value);
    const safeDecimals = Math.max(0, Math.min(36, decimals));
    const divisor = BigInt(10) ** BigInt(safeDecimals);
    const whole = raw / divisor;
    const fraction = (raw % divisor)
      .toString()
      .padStart(safeDecimals, '0')
      .slice(0, 12)
      .replace(/0+$/, '');
    const amount = Number(`${whole}${fraction ? `.${fraction}` : ''}`);
    return Number.isFinite(amount) ? amount : 0;
  } catch {
    return 0;
  }
}
