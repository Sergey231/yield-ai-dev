import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { ExponentFetcher } from "@exponent-labs/exponent-fetcher";
import { IDL as ClmmIdl } from "@exponent-labs/exponent-clmm-idl";
import { ExponentVault } from "@exponent-labs/exponent-sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  fetchMarketsCatalog,
  getStrategyVaultMintMap,
  type ExponentMarketRow,
} from "@/lib/services/exponent/exponentCatalog";
import type {
  ExponentUserPositionRow,
  ExponentUserPositionsResult,
} from "@/lib/services/exponent/types";
import { JupiterTokenMetadataService } from "@/lib/services/solana/tokenMetadata";
const YIELD_TOKEN_POSITION_OWNER_OFFSET = 8;
const CLMM_LP_POSITION_OWNER_OFFSET = 8;

const STABLE_QUOTE_TICKERS = new Set(["USDC", "USDT", "USD", "USDS", "JupUSD", "USDG"]);
const STABLE_QUOTE_MINTS = new Set([
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "USD1111111111111111111111111111111111111111",
  "USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA",
  "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD",
]);

/** Known strategy vault labels until a public metadata API exists. */
const KNOWN_STRATEGY_VAULT_LABELS: Record<
  string,
  { name: string; symbol?: string; iconMint?: string; iconSymbol?: string }
> = {
  "9iPUphFXxnyAKYnCTG3XZv5ybHv5Ki1diqA5mis3TBVB": {
    name: "OnRe Growth",
    symbol: "lsONyc",
    iconMint: "5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5",
    iconSymbol: "ONyc",
  },
};

type WalletTokenBalance = {
  amount: string;
  uiAmount: number | null;
  decimals: number;
};

function isStableQuote(market: ExponentMarketRow): boolean {
  const ticker = market.quoteAsset?.ticker?.toUpperCase();
  const mint = market.quoteAsset?.mint;
  if (ticker && STABLE_QUOTE_TICKERS.has(ticker)) return true;
  if (mint && STABLE_QUOTE_MINTS.has(mint)) return true;
  return false;
}

function quoteToUsdMultiplier(market: ExponentMarketRow): number {
  return isStableQuote(market) ? 1 : 1;
}

function valueFromMarketAmount(
  market: ExponentMarketRow,
  kind: "PT" | "YT",
  amountUi: number
): number | null {
  const priceInAsset =
    kind === "PT" ? market.ptPriceInAsset : market.ytPriceInAsset;
  if (typeof priceInAsset !== "number" || !Number.isFinite(priceInAsset)) return null;
  return amountUi * priceInAsset * quoteToUsdMultiplier(market);
}

async function getWalletTokenBalances(
  connection: Connection,
  owner: string
): Promise<Map<string, WalletTokenBalance>> {
  const ownerPk = new PublicKey(owner);
  const [spl, spl2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(ownerPk, { programId: TOKEN_2022_PROGRAM_ID }),
  ]);

  const out = new Map<string, WalletTokenBalance>();
  for (const { account } of [...spl.value, ...spl2022.value]) {
    const info = account.data.parsed?.info;
    if (!info?.mint) continue;
    const amount = String(info.tokenAmount?.amount ?? "0");
    if (BigInt(amount) <= 0n) continue;
    out.set(info.mint, {
      amount,
      uiAmount: info.tokenAmount?.uiAmount ?? null,
      decimals: info.tokenAmount?.decimals ?? 0,
    });
  }
  return out;
}

function uiAmountFromRaw(raw: string | bigint, decimals: number): number {
  const n = typeof raw === "bigint" ? raw : BigInt(raw);
  return Number(n) / 10 ** decimals;
}

function underlyingFromMarket(market: ExponentMarketRow | undefined): {
  underlyingMint?: string;
  underlyingSymbol?: string;
} {
  if (!market) return {};
  return {
    underlyingMint: market.underlyingAsset?.mint,
    underlyingSymbol: market.underlyingAsset?.ticker ?? market.tokenName,
  };
}

async function enrichUnderlyingLogos(positions: ExponentUserPositionRow[]): Promise<void> {
  const mints = [
    ...new Set(
      positions.flatMap((row) =>
        [row.underlyingMint, row.tokenIconMint].filter(
          (mint): mint is string => typeof mint === "string" && mint.length > 0
        )
      )
    ),
  ];
  if (mints.length === 0) return;

  const meta = await JupiterTokenMetadataService.getInstance().getMetadataMap(mints);
  for (const row of positions) {
    const iconMint = row.tokenIconMint;
    if (iconMint) {
      const iconMeta = meta[iconMint];
      if (iconMeta?.logoUrl) row.underlyingLogoUrl = iconMeta.logoUrl;
      if (row.tokenIconSymbol) row.underlyingSymbol = row.tokenIconSymbol;
      else if (!row.underlyingSymbol && iconMeta?.symbol) row.underlyingSymbol = iconMeta.symbol;
      continue;
    }
    if (!row.underlyingMint) continue;
    const record = meta[row.underlyingMint];
    if (record?.logoUrl) row.underlyingLogoUrl = record.logoUrl;
    if (!row.underlyingSymbol && record?.symbol) row.underlyingSymbol = record.symbol;
  }
}

export async function fetchExponentUserPositions(params: {
  connection: Connection;
  wallet: string;
  includeTimings?: boolean;
}): Promise<ExponentUserPositionsResult> {
  const { connection, wallet, includeTimings } = params;
  const timings: Record<string, number> = {};
  const mark = (key: string, start: number) => {
    if (includeTimings) timings[key] = Date.now() - start;
  };

  const t0 = Date.now();
  const markets = await fetchMarketsCatalog();
  mark("marketsMs", t0);

  const mintToMarket = new Map<string, ExponentMarketRow & { kind: "PT" | "YT" }>();
  const vaultToMarket = new Map<string, ExponentMarketRow>();
  for (const market of markets) {
    if (market.vaultAddress) vaultToMarket.set(market.vaultAddress, market);
    if (market.ptMint) mintToMarket.set(market.ptMint, { ...market, kind: "PT" });
    if (market.ytMint) mintToMarket.set(market.ytMint, { ...market, kind: "YT" });
  }

  const t1 = Date.now();
  const tokenBalances = await getWalletTokenBalances(connection, wallet);
  mark("walletSplMs", t1);

  const positions: ExponentUserPositionRow[] = [];

  for (const [mint, bal] of tokenBalances) {
    const market = mintToMarket.get(mint);
    if (!market || !market.vaultAddress) continue;
    const amountUi =
      bal.uiAmount ?? uiAmountFromRaw(bal.amount, bal.decimals);
    const ticker = market.underlyingAsset?.ticker ?? market.tokenName;
    const underlying = underlyingFromMarket(market);
    positions.push({
      source: market.kind === "PT" ? "exponent-pt" : "exponent-yt",
      vaultAddress: market.vaultAddress,
      symbol: `${market.kind}-${ticker ?? "?"}`,
      ticker,
      platform: market.platformName ?? market.platform,
      mint,
      amountRaw: bal.amount,
      amountUi,
      impliedApy: market.impliedApy,
      maturityDateUnixTs: market.maturityDateUnixTs,
      ...underlying,
      valueUsd: valueFromMarketAmount(market, market.kind, amountUi),
    });
  }

  const t2 = Date.now();
  const provider = new AnchorProvider(connection, new Wallet(Keypair.generate()));
  const fetcher = new ExponentFetcher({ connection });
  const clmmProgram = new Program(ClmmIdl, provider);
  const clmmAccounts = clmmProgram.account as {
    lpPosition: {
      all: (
        filters: Array<{ memcmp: { offset: number; bytes: string } }>
      ) => Promise<
        Array<{
          publicKey: PublicKey;
          account: {
            lpBalance?: { toString?: () => string } | string | bigint | number;
            market?: PublicKey | string;
          };
        }>
      >;
    };
  };
  const ownerPk = new PublicKey(wallet);

  const [ytPositions, lpPositions, lpMintToVault] = await Promise.all([
    fetcher.program.account.yieldTokenPosition.all([
      { memcmp: { offset: YIELD_TOKEN_POSITION_OWNER_OFFSET, bytes: wallet } },
    ]),
    clmmAccounts.lpPosition.all([
      { memcmp: { offset: CLMM_LP_POSITION_OWNER_OFFSET, bytes: wallet } },
    ]),
    getStrategyVaultMintMap(connection),
  ]);
  mark("onChainAccountsMs", t2);

  for (const pos of ytPositions) {
    const ytRaw = BigInt(pos.account.ytBalance?.toString?.() ?? pos.account.ytBalance ?? 0);
    if (ytRaw <= 0n) continue;
    const vaultPk =
      pos.account.vault?.toBase58?.() ??
      (typeof pos.account.vault === "string" ? pos.account.vault : undefined);
    const market = vaultPk ? vaultToMarket.get(vaultPk) : undefined;
    const decimals = market?.decimals ?? 9;
    const amountUi = uiAmountFromRaw(ytRaw, decimals);
    const ticker = market?.underlyingAsset?.ticker ?? market?.tokenName;
    const underlying = underlyingFromMarket(market);
    positions.push({
      source: "exponent-yt-staked",
      vaultAddress: vaultPk ?? "",
      positionAddress: pos.publicKey.toBase58(),
      symbol: `YT-staked-${ticker ?? "?"}`,
      ticker,
      platform: market?.platformName ?? market?.platform,
      amountRaw: ytRaw.toString(),
      amountUi,
      impliedApy: market?.impliedApy,
      maturityDateUnixTs: market?.maturityDateUnixTs,
      ...underlying,
      valueUsd: market ? valueFromMarketAmount(market, "YT", amountUi) : null,
    });
  }

  for (const pos of lpPositions) {
    const lpBalanceRaw = pos.account.lpBalance;
    const lpBalance = BigInt(
      typeof lpBalanceRaw === "object" && lpBalanceRaw && "toString" in lpBalanceRaw
        ? lpBalanceRaw.toString?.() ?? "0"
        : String(lpBalanceRaw ?? 0)
    );
    if (lpBalance <= 0n) continue;
    const marketRaw = pos.account.market;
    const clmmMarketAddress =
      typeof marketRaw === "string"
        ? marketRaw
        : marketRaw?.toBase58?.() ?? "";
    positions.push({
      source: "exponent-clmm",
      vaultAddress: clmmMarketAddress,
      clmmMarketAddress,
      positionAddress: pos.publicKey.toBase58(),
      symbol: "CLMM-LP",
      amountRaw: lpBalance.toString(),
      amountUi: Number(lpBalance),
      valueUsd: null,
    });
  }

  const lpMintToVaultEntries = [...lpMintToVault.entries()];
  const t3 = Date.now();
  const strategyVaultLoads: Array<{
    vaultAddress: string;
    shareMint: string;
    amountRaw: string;
    amountUi: number;
  }> = [];

  for (const [shareMint, bal] of tokenBalances) {
    const vaultAddress = lpMintToVault.get(shareMint);
    if (!vaultAddress) continue;
    const amountUi =
      bal.uiAmount ?? uiAmountFromRaw(bal.amount, bal.decimals);
    strategyVaultLoads.push({
      vaultAddress,
      shareMint,
      amountRaw: bal.amount,
      amountUi,
    });
  }

  await Promise.all(
    strategyVaultLoads.map(async (row) => {
      const vault = await ExponentVault.load({
        connection,
        address: new PublicKey(row.vaultAddress),
      });
      const [lpPrice, underlyingMint] = await Promise.all([
        vault.getLpPrice(),
        Promise.resolve(vault.state.underlyingMint?.toBase58?.() ?? String(vault.state.underlyingMint ?? "")),
      ]);
      const labels = KNOWN_STRATEGY_VAULT_LABELS[row.vaultAddress];
      const valueUsd = row.amountUi * lpPrice;
      positions.push({
        source: "exponent-strategy-vault",
        vaultAddress: row.vaultAddress,
        mint: row.shareMint,
        symbol: labels?.symbol ?? labels?.name ?? "Strategy Vault",
        ticker: labels?.name,
        amountRaw: row.amountRaw,
        amountUi: row.amountUi,
        lpPrice,
        underlyingMint,
        tokenIconMint: labels?.iconMint,
        tokenIconSymbol: labels?.iconSymbol,
        valueUsd,
      });
    })
  );
  mark("strategyVaultPricingMs", t3);

  const t4 = Date.now();
  await enrichUnderlyingLogos(positions);
  mark("underlyingLogosMs", t4);

  const totalValueUsd = positions.reduce((sum, row) => sum + (row.valueUsd ?? 0), 0);

  return {
    positions,
    meta: {
      wallet,
      totalValueUsd,
      marketsCatalogCount: markets.length,
      strategyVaultCatalogCount: lpMintToVaultEntries.length,
      walletSplMintsWithBalance: tokenBalances.size,
      ...(includeTimings ? { timingsMs: timings } : {}),
    },
  };
}
