"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import { ArrowLeftRight, Loader2, Info, AlertCircle, CheckCircle, XCircle, Copy, ExternalLink, Settings, X, Search, LineChart } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useWalletData } from '@/contexts/WalletContext';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { useWallet as useSolanaWallet, useConnection as useSolanaConnection } from "@solana/wallet-adapter-react";
import { isUserRejectedError } from '@/lib/utils/errors';
import { getTokenUsdValue } from "@/lib/utils/tokenUsdValue";
import { useSolanaPortfolio } from "@/hooks/useSolanaPortfolio";
import { Token } from '@/lib/types/panora';
import tokenList from '@/lib/data/tokenList.json';
import { getProtocolsList } from '@/lib/protocols/getProtocolsList';
import { cn } from '@/lib/utils';
import { SwapTokenChart } from '@/components/ui/swap-token-chart';
import { useWalletStore } from "@/lib/stores/walletStore";
import { TOKEN_REGISTRY } from "@/lib/tokens/registry";
// Убираем useWalletStore - используем готовые цены из tokens
// import { useWalletStore } from '@/lib/stores/walletStore';

// Aptos (Panora) token + actual price from wallet
type AptosTokenWithActualPrice = Token & { actualPrice?: string | null };

function formatBpsAsPercent(bps: number): string {
  const safe = Number.isFinite(bps) ? Math.max(0, Math.min(10_000, Math.floor(bps))) : 0;
  return `${(safe / 100).toFixed(2)}%`;
}

const DEFAULT_JUPITER_PLATFORM_FEE_BPS_UI = 1;

// Minimal Solana token stub for UI only (not a Panora token)
type SolanaTokenStub = {
  tokenAddress: string;
  faAddress: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUrl: string;
  actualPrice?: string | null;
};

type SwapToken = AptosTokenWithActualPrice | SolanaTokenStub;
type SwapChain = "aptos" | "solana";

type TokenPickerTab = "all" | "stablecoin" | "lst" | "xStocks" | "l1";

function solanaSwapMint(stub: Pick<SolanaTokenStub, "faAddress" | "tokenAddress">): string {
  return String(stub.faAddress || stub.tokenAddress || "").toLowerCase();
}

function normalizeAptosFaForBirdeye(fa: string): string {
  const s = fa.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(s)) return s;
  const hex = s.slice(2);
  if (hex.length >= 64) return `0x${hex}`;
  return `0x${hex.padStart(64, "0")}`;
}

function chartAddressForBirdeye(
  t: SwapToken | null,
  chainSelection: SwapChain
): { chain: SwapChain; address: string } | null {
  if (!t) return null;

  if (chainSelection === "solana") {
    if ("chainId" in (t as AptosTokenWithActualPrice)) return null;
    const m = String((t as SolanaTokenStub).tokenAddress || (t as SolanaTokenStub).faAddress || "").trim();
    return m ? { chain: "solana", address: m } : null;
  }

  // aptos
  if (!("chainId" in (t as AptosTokenWithActualPrice))) return null;
  const fa = String((t as any)?.faAddress || (t as any)?.tokenAddress || "").trim();
  if (!fa) return null;
  return { chain: "aptos", address: normalizeAptosFaForBirdeye(fa) };
}

/** Panora-shaped record so the same SelectItem row layout works for Solana allowlist tokens. */
function solanaStubTokenInfo(stub: SolanaTokenStub): Token {
  return {
    chainId: 1,
    panoraId: "",
    tokenAddress: stub.tokenAddress,
    faAddress: stub.faAddress,
    name: stub.name,
    symbol: stub.symbol,
    decimals: stub.decimals,
    bridge: null,
    panoraSymbol: stub.symbol,
    usdPrice: "0",
    logoUrl: stub.logoUrl,
    websiteUrl: null,
    panoraUI: false,
    panoraTags: [],
    panoraIndex: 0,
    coinGeckoId: null,
    coinMarketCapId: 0,
    isInPanoraTokenList: false,
    isBanned: false,
  };
}

function solanaTokenInfoFromWalletToken(t: {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoUrl?: string;
}): Token {
  return {
    chainId: 1,
    panoraId: "",
    tokenAddress: t.address,
    faAddress: t.address,
    name: t.name,
    symbol: t.symbol,
    decimals: t.decimals,
    bridge: null,
    panoraSymbol: t.symbol,
    usdPrice: "0",
    logoUrl: t.logoUrl || "/file.svg",
    websiteUrl: null,
    panoraUI: false,
    panoraTags: [],
    panoraIndex: 0,
    coinGeckoId: null,
    coinMarketCapId: 0,
    isInPanoraTokenList: false,
    isBanned: false,
  };
}

function solanaStubFromTokenInfo(tokenInfo: Token, actualPrice?: string | null): SolanaTokenStub {
  const mint = String(tokenInfo.faAddress || tokenInfo.tokenAddress || "");
  return {
    name: tokenInfo.name || tokenInfo.symbol,
    symbol: tokenInfo.symbol,
    decimals: tokenInfo.decimals,
    tokenAddress: mint,
    faAddress: mint,
    logoUrl: tokenInfo.logoUrl || "/file.svg",
    actualPrice: actualPrice ?? null,
  };
}

function buildSolanaMintIndex(solanaTokens: { address?: string }[] | undefined): Map<string, any> {
  const m = new Map<string, any>();
  for (const t of solanaTokens ?? []) {
    const a = String(t?.address || "").toLowerCase();
    if (a) m.set(a, t);
  }
  return m;
}

const SOLANA_SWAP_TOKENS: SolanaTokenStub[] = [
  {
    name: "Solana",
    symbol: "SOL",
    decimals: 9,
    tokenAddress: "So11111111111111111111111111111111111111112",
    faAddress: "So11111111111111111111111111111111111111112",
    logoUrl: "/token_ico/sol.png",
  },
  {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    tokenAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    faAddress: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    logoUrl:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  },
  {
    name: "Jupiter",
    symbol: "JUP",
    decimals: 6,
    tokenAddress: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    faAddress: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    logoUrl: "https://static.jup.ag/jup/icon.png",
  },
  {
    name: "Jito",
    symbol: "JTO",
    decimals: 9,
    tokenAddress: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    faAddress: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    logoUrl: "https://metadata.jito.network/token/jto/image",
  },
  {
    name: "Raydium",
    symbol: "RAY",
    decimals: 6,
    tokenAddress: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    faAddress: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    logoUrl:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png",
  },
  {
    name: "Pyth Network",
    symbol: "PYTH",
    decimals: 6,
    tokenAddress: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    faAddress: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    logoUrl: "https://pyth.network/token.svg",
  },
  {
    name: "Kamino",
    symbol: "KMNO",
    decimals: 6,
    tokenAddress: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS",
    faAddress: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS",
    logoUrl: "https://cdn.kamino.finance/kamino.svg",
  },
  {
    name: "Ether (Portal)",
    symbol: "WETH",
    decimals: 8,
    tokenAddress: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    faAddress: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    logoUrl:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png",
  },
  {
    name: "Coinbase Wrapped BTC",
    symbol: "cbBTC",
    decimals: 8,
    tokenAddress: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
    faAddress: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
    logoUrl: "https://ipfs.io/ipfs/QmZ7L8yd5j36oXXydUiYFiFsRHbi3EdgC4RuFwvM7dcqge",
  },
  {
    name: "Zcash",
    symbol: "ZEC",
    decimals: 8,
    tokenAddress: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS",
    faAddress: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS",
    logoUrl: "https://arweave.net/QSYqnmB7NYlB7n1R6rz935Y07dlRK0tIuKe2mof5Sho",
  },
  {
    name: "HYPE",
    symbol: "HYPE",
    decimals: 9,
    tokenAddress: "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g",
    faAddress: "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g",
    logoUrl: "https://arweave.net/QBRdRop8wI4PpScSRTKyibv-fQuYBua-WOvC7tuJyJo",
  },
  {
    name: "TRON",
    symbol: "TRX",
    decimals: 6,
    tokenAddress: "GbbesPbaYh5uiAZSYNXTc7w9jty1rpg3P9L4JeN4LkKc",
    faAddress: "GbbesPbaYh5uiAZSYNXTc7w9jty1rpg3P9L4JeN4LkKc",
    logoUrl: "https://arweave.net/aO9owy2SUH92KGJ2CH3BFowep6XFAoYjjpRyDKObkww",
  },
  {
    name: "Pump",
    symbol: "PUMP",
    decimals: 6,
    tokenAddress: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
    faAddress: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
    logoUrl: "https://ipfs.io/ipfs/bafkreibyb3hcn7gglvdqpmklfev3fut3eqv3kje54l3to3xzxxbgpt5wjm",
  },
  {
    name: "Seeker",
    symbol: "SKR",
    decimals: 6,
    tokenAddress: "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3",
    faAddress: "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3",
    logoUrl: "https://gateway.irys.xyz/uP1dFvCofZQT26m3SKOCttXrir3ORBR1B8wPhP6tv7M?ext=png",
  },
  {
    name: "Circle xStock",
    symbol: "CRCLx",
    decimals: 8,
    tokenAddress: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    faAddress: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/CRCLx.png",
  },
  {
    name: "Tesla xStock",
    symbol: "TSLAx",
    decimals: 8,
    tokenAddress: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    faAddress: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/TSLAx.png",
  },
  {
    name: "NVIDIA xStock",
    symbol: "NVDAx",
    decimals: 8,
    tokenAddress: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    faAddress: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/NVDAx.png",
  },
  {
    name: "SP500 xStock",
    symbol: "SPYx",
    decimals: 8,
    tokenAddress: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    faAddress: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/SPYx.png",
  },
  {
    name: "Alphabet xStock",
    symbol: "GOOGLx",
    decimals: 8,
    tokenAddress: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    faAddress: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/GOOGLx.png",
  },
  {
    name: "Apple xStock",
    symbol: "AAPLx",
    decimals: 8,
    tokenAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    faAddress: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/AAPLx.png",
  },
  {
    name: "Meta xStock",
    symbol: "METAx",
    decimals: 8,
    tokenAddress: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    faAddress: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/METAx.png",
  },
  {
    name: "McDonald's xStock",
    symbol: "MCDx",
    decimals: 8,
    tokenAddress: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2",
    faAddress: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2",
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/MCDx.png",
  },
  {
    name: "Tether Gold",
    symbol: "XAUt0",
    decimals: 6,
    tokenAddress: "AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P",
    faAddress: "AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P",
    logoUrl: "https://ipfs.io/ipfs/bafkreibth2yh4jlehmf5nmfgy763z4yvwxlz7zmuohmhp53un6wrho5t2q",
  },
];

interface SwapQuote {
  amount: string;
  path: string[];
  estimatedFromAmount?: string;
  estimatedToAmount?: string;
}

interface SwapResult {
  success: boolean;
  hash?: string;
  error?: string;
  receivedAmount?: string;
  receivedSymbol?: string;
}

export interface SwapModalPrefill {
  fromFaAddress: string;
  toFaAddress: string;
  amount?: string;
}

interface SwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When set, modal applies from/to/amount after open (e.g. hedge flow). */
  prefill?: SwapModalPrefill | null;
  variantTitle?: string;
  variantDescription?: string;
}

function ChainGlyph({ chain, className }: { chain: "aptos" | "solana"; className?: string }) {
  const src = chain === "aptos" ? "/chain_ico/aptos2.png" : "/chain_ico/solana2.png";
  return (
    <img
      src={src}
      alt=""
      width={14}
      height={14}
      className={cn("h-3.5 w-3.5 shrink-0 object-contain", className)}
      loading="lazy"
      decoding="async"
    />
  );
}

function CategoryTag({ tab }: { tab: Exclude<TokenPickerTab, "all"> }) {
  const map: Record<Exclude<TokenPickerTab, "all">, { label: string; color: string }> = {
    stablecoin: { label: "$ Stable", color: "#16a34a" },
    lst: { label: "⚡ LST", color: "#2563eb" },
    xStocks: { label: "📈 Stock", color: "#d97706" },
    l1: { label: "L1", color: "#6b7280" },
  };
  const cfg = map[tab];
  return (
    <span
      className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none"
      style={{
        color: cfg.color,
        backgroundColor: `${cfg.color}14`,
        borderColor: `${cfg.color}28`,
      }}
    >
      {cfg.label}
    </span>
  );
}

function ChainTag({ chain }: { chain: SwapChain }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
      <ChainGlyph chain={chain} />
      <span className="leading-none">{chain === "aptos" ? "Aptos" : "Solana"}</span>
    </span>
  );
}

/** Token logos are often remote URLs; avoid next/image optimization so they reliably render. */
function TokenIcon({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const resolvedSrc = src || (alt?.toUpperCase?.() === "SOL" ? "/token_ico/sol.png" : "/file.svg");
  return (
    <img
      src={resolvedSrc}
      alt={alt}
      width={16}
      height={16}
      className={cn('h-4 w-4 shrink-0 rounded-full object-cover', className)}
      loading="lazy"
      decoding="async"
    />
  );
}

export function SwapModal({
  isOpen,
  onClose,
  prefill = null,
  variantTitle,
  variantDescription,
}: SwapModalProps) {
  const { tokens, address: userAddress, refreshPortfolio } = useWalletData();
  const { signAndSubmitTransaction, connected } = useWallet();
  const { connection: solanaConnection } = useSolanaConnection();
  const {
    publicKey: solanaPublicKey,
    connected: solanaConnected,
    wallet: solanaWallet,
    wallets: solanaWallets,
    signTransaction,
  } =
    useSolanaWallet();

  const gaslessSwapEnabled =
    process.env.NEXT_PUBLIC_GASLESS_SWAP === "1" ||
    process.env.NEXT_PUBLIC_GASLESS_SWAP === "true";

  const allowSolanaAddressOverride =
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "1" ||
    process.env.NEXT_PUBLIC_KAMINO_REWARDS_MOCK === "true";

  const isLikelySolanaAddress = (input: string): boolean => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input);

  const [solanaAddressOverride, setSolanaAddressOverride] = useState<string | null>(null);
  useEffect(() => {
    if (!allowSolanaAddressOverride) {
      setSolanaAddressOverride(null);
      return;
    }
    try {
      const sp = new URLSearchParams(window.location.search);
      const raw = (sp.get("solanaAddress") || sp.get("solana") || "").trim();
      setSolanaAddressOverride(raw && isLikelySolanaAddress(raw) ? raw : null);
    } catch {
      setSolanaAddressOverride(null);
    }
  }, [allowSolanaAddressOverride]);

  const {
    address: solanaAddress,
    totalValueUsd: solanaTotalValueUsd,
    tokens: solanaTokens,
    refresh: refreshSolanaPortfolio,
  } = useSolanaPortfolio({ overrideAddress: solanaAddressOverride });

  const solanaResolved = useMemo(() => {
    const connectedAdapter =
      solanaWallets?.find((w: any) => w?.adapter?.connected && w?.adapter?.publicKey) ?? null;
    const adapter = (solanaWallet?.adapter ?? connectedAdapter?.adapter ?? null) as any;
    const publicKey = (adapter?.publicKey ?? solanaPublicKey ?? null) as any;
    const signTx =
      signTransaction ??
      (typeof adapter?.signTransaction === "function" ? adapter.signTransaction.bind(adapter) : null);
    return { adapter, publicKey, signTx };
  }, [solanaPublicKey, solanaWallet, solanaWallets, signTransaction]);

  const solanaTakerAddress = useMemo(() => {
    return (
      (solanaResolved.publicKey ? solanaResolved.publicKey.toBase58?.() ?? null : null) ??
      (solanaConnected && solanaPublicKey ? solanaPublicKey.toBase58() : null) ??
      (solanaAddress ?? null)
    );
  }, [solanaAddress, solanaConnected, solanaPublicKey, solanaResolved.publicKey]);

  const solanaCanSign = useMemo(() => {
    return Boolean(solanaResolved.signTx && solanaResolved.publicKey);
  }, [solanaResolved.publicKey, solanaResolved.signTx]);

  // Убираем fetchPrices - используем готовые цены из tokens
  // const { prices, fetchPrices } = useWalletStore();

  // Используем готовые цены из tokens кошелька - не нужно логировать
  // console.log('[SwapModal] Current tokens with prices:', tokens);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [swapResult, setSwapResult] = useState<SwapResult | null>(null);
  const [quoteDebug, setQuoteDebug] = useState<any>(null);
  const [showSlippage, setShowSlippage] = useState(false);
  const [jupiterPlatformFeeBpsUi, setJupiterPlatformFeeBpsUi] = useState<number>(DEFAULT_JUPITER_PLATFORM_FEE_BPS_UI);
  const [chainSelection, setChainSelection] = useState<SwapChain>("aptos");
  const didUserSelectChainRef = useRef(false);
  const [tokenPickerOpenFor, setTokenPickerOpenFor] = useState<"from" | "to" | null>(null);
  const [tokenPickerQuery, setTokenPickerQuery] = useState<string>("");
  const [tokenPickerTab, setTokenPickerTab] = useState<TokenPickerTab>("all");
  const [chartToken, setChartToken] = useState<{ mint: string; symbol: string; logoUrl?: string; chain: SwapChain } | null>(null);

  // Local optimistic balances override for UI after successful swap
  const [balancesOverride, setBalancesOverride] = useState<Record<string, number>>({});

  // Fetched prices for tokens not in wallet (keyed by mint/faAddress lowercase)
  const [fetchedPrices, setFetchedPrices] = useState<Record<string, string>>({});

  // Состояние для отслеживания изменений данных
  const [lastQuoteData, setLastQuoteData] = useState({
    fromToken: null as SwapToken | null,
    toToken: null as SwapToken | null,
    amount: '',
    slippage: 0.5
  });

  // Token selection
  const [fromToken, setFromToken] = useState<SwapToken | null>(null);
  const [toToken, setToToken] = useState<SwapToken | null>(null);
  const [amount, setAmount] = useState<string>('');
  const [slippage, setSlippage] = useState<number>(0.5);
  const lastAptosPairRef = useRef<{ from: SwapToken | null; to: SwapToken | null }>({
    from: null,
    to: null,
  });

  const prefillSessionRef = useRef(false);
  const prefillRequestedAmountRef = useRef<string>('');
  const autoClampedFromPrefillRef = useRef(false);

  const walletPriceForFa = (faOrAddr: string | undefined): string | undefined => {
    if (!faOrAddr) return undefined;
    const n = (x: string) =>
      (x.startsWith('0x') ? '0x' + x.slice(2).replace(/^0+/, '') || '0x0' : x).toLowerCase();
    const target = n(faOrAddr);
    const w = tokens.find((t) => n(t.address) === target);
    const p = w?.price;
    return p == null ? undefined : p;
  };

  const aptosTotalValueUsd = useMemo(() => {
    return (tokens ?? []).reduce((sum, t: any) => sum + getTokenUsdValue(t as any), 0);
  }, [tokens]);

  const aptosTotalWithProtocolsUsd = useWalletStore((s) => s.totalAssets);
  const solanaTotalWithProtocolsUsd = useWalletStore((s) => s.solanaTotalAssets);

  // Default chain selection (UI only): choose the chain with higher assets, or the only connected chain.
  useEffect(() => {
    if (!isOpen) {
      didUserSelectChainRef.current = false;
      // Full modal reset on close to avoid stale chain/token state on next open.
      setLoading(false);
      setError(null);
      setSwapQuote(null);
      setSwapResult(null);
      setQuoteDebug(null);
      setShowSlippage(false);
      setBalancesOverride({});
      setLastQuoteData({ fromToken: null, toToken: null, amount: "", slippage: 0.5 });
      setFromToken(null);
      setToToken(null);
      setAmount("");
      setSlippage(0.5);
      lastAptosPairRef.current = { from: null, to: null };
      setChainSelection("aptos");
      return;
    }
    if (didUserSelectChainRef.current) return;

    const hasAptos = Boolean(userAddress) || connected;
    const hasSolana = Boolean(solanaAddress);

    if (hasSolana && !hasAptos) {
      setChainSelection("solana");
      return;
    }
    if (hasAptos && !hasSolana) {
      setChainSelection("aptos");
      return;
    }
    if (hasAptos && hasSolana) {
      const sol = Number.isFinite(solanaTotalWithProtocolsUsd as any)
        ? (solanaTotalWithProtocolsUsd ?? 0)
        : (Number.isFinite(solanaTotalValueUsd as any) ? (solanaTotalValueUsd ?? 0) : 0);
      const apt = Number.isFinite(aptosTotalWithProtocolsUsd as any)
        ? (aptosTotalWithProtocolsUsd ?? 0)
        : (Number.isFinite(aptosTotalValueUsd as any) ? aptosTotalValueUsd : 0);
      setChainSelection(sol > apt ? "solana" : "aptos");
    }
  }, [
    isOpen,
    userAddress,
    connected,
    solanaAddress,
    solanaTotalValueUsd,
    aptosTotalValueUsd,
    aptosTotalWithProtocolsUsd,
    solanaTotalWithProtocolsUsd,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!isOpen) return;

    fetch("/api/jupiter/config", { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as { platformFeeBps?: unknown };
        const n = Number((data as any)?.platformFeeBps);
        if (!cancelled && Number.isFinite(n) && n >= 0) {
          setJupiterPlatformFeeBpsUi(Math.max(0, Math.min(10_000, Math.floor(n))));
        }
      })
      .catch(() => {
        // keep default
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Chain switch UX: for Solana show only SOL/USDC with defaults (SOL -> USDC).
  // When switching back to Aptos, restore the last Aptos pair (if any).
  useEffect(() => {
    if (!isOpen) return;

    if (chainSelection === "solana") {
      // Save current Aptos selection to restore later.
      lastAptosPairRef.current = { from: fromToken, to: toToken };
      const sol = SOLANA_SWAP_TOKENS.find((t) => t.symbol === "SOL") ?? null;
      const usdc = SOLANA_SWAP_TOKENS.find((t) => t.symbol === "USDC") ?? null;
      setFromToken(sol);
      setToToken(usdc);
      setAmount("");
      setSwapQuote(null);
      setQuoteDebug(null);
      setSwapResult(null);
      setError(null);
      setLastQuoteData({ fromToken: null, toToken: null, amount: "", slippage: 0.5 });
      return;
    }

    const prev = lastAptosPairRef.current;
    if (prev.from || prev.to) {
      setFromToken(prev.from);
      setToToken(prev.to);
      setSwapQuote(null);
      setQuoteDebug(null);
      setSwapResult(null);
      setError(null);
      setLastQuoteData({ fromToken: null, toToken: null, amount: "", slippage: 0.5 });
    }
  }, [chainSelection, isOpen]);

  // Returns the best available price for a token (wallet price → Panora usdPrice → fetched)
  const getEffectivePrice = (token: SwapToken | null): number => {
    if (!token) return 0;
    const actual = Number((token as any).actualPrice || 0);
    if (actual > 0) return actual;
    if ("chainId" in (token as any)) {
      const p = Number((token as any).usdPrice || 0);
      if (p > 0) return p;
    } else {
      const mint = solanaSwapMint(token as any);
      const p = Number(fetchedPrices[mint] || 0);
      if (p > 0) return p;
    }
    return 0;
  };

  // USD amount calculated from input amount and fromToken effective price
  const usdAmount = useMemo(() => {
    const price = getEffectivePrice(fromToken);
    const qty = Number(amount || 0);
    if (!isFinite(price) || !isFinite(qty)) return 0;
    return qty * price;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, fromToken, fetchedPrices]);


  // Get Panora fee from configuration
  const panoraFee = useMemo(() => {
    const protocols = getProtocolsList();
    const panoraProtocol = protocols.find(p => p.name === 'Panora');
    const feePercentage = panoraProtocol?.panoraConfig?.integratorFeePercentage;
    return feePercentage || '0.25';
  }, []);

  // TO token balance
  const toBal = useMemo(() => {
    if (!toToken) return null;
    // getTokenBalance is defined later; mirror its logic here
    if (chainSelection === "solana") {
      const addr = String((toToken as any)?.tokenAddress || (toToken as any)?.faAddress || "").toLowerCase();
      if (!addr) return 0;
      const t = (solanaTokens ?? []).find((x: any) => String(x?.address || "").toLowerCase() === addr);
      if (!t) return 0;
      const raw = Number((t as any).amount);
      const dec = Number((t as any).decimals ?? toToken.decimals ?? 9);
      const h = raw / Math.pow(10, dec);
      return Number.isFinite(h) ? h : 0;
    }
    const bal = findTokenBalance(tokens, toToken as any);
    const h = Number(bal) / Math.pow(10, (toToken as any).decimals ?? 8);
    const key = ((toToken as any).faAddress || (toToken as any).tokenAddress || "").toLowerCase();
    const ov = key ? balancesOverride[key] : undefined;
    return typeof ov === "number" ? ov : h;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toToken, tokens, balancesOverride, solanaTokens, chainSelection]);

  // USD value of the "you receive" amount
  const receiveUsdValue = useMemo(() => {
    if (!swapQuote || !toToken) return null;
    const panora = quoteDebug?.quotes?.[0]?.toTokenAmountUSD;
    if (panora) { const v = parseFloat(panora); if (v > 0) return v; }
    const amt = Number(swapQuote.estimatedToAmount || swapQuote.amount || 0);
    const p = getEffectivePrice(toToken);
    if (amt > 0 && p > 0) return amt * p;
    return null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapQuote, quoteDebug, toToken, fetchedPrices]);

  // Exchange rate from actual quote amounts
  const exchangeRate = useMemo(() => {
    if (!swapQuote || !fromToken || !toToken) return null;
    const from = Number(amount || 0);
    const to = Number(swapQuote.estimatedToAmount || swapQuote.amount || 0);
    if (!from || !to) return null;
    return to / from;
  }, [swapQuote, amount, fromToken, toToken]);

  // Min received from quote
  const quoteMinReceived = useMemo(() => {
    if (!swapQuote) return null;
    if (chainSelection === "solana") {
      if (quoteDebug?.otherAmountThreshold != null && toToken?.decimals != null)
        return baseUnitsToDecimalString(String(quoteDebug.otherAmountThreshold), Number(toToken.decimals));
      return null;
    }
    return (quoteDebug?.quotes?.[0]?.minToTokenAmount as string | undefined) ?? null;
  }, [swapQuote, quoteDebug, chainSelection, toToken]);

  // Price impact from quote
  const quotePriceImpact = useMemo(() => {
    if (!swapQuote) return null;
    if (chainSelection === "solana") {
      const p = quoteDebug?.priceImpactPct;
      return p != null ? String(parseFloat(p).toFixed(4)) : null;
    }
    return (quoteDebug?.quotes?.[0]?.priceImpact as string | undefined) ?? null;
  }, [swapQuote, quoteDebug, chainSelection]);

  // Available tokens from wallet
  const availableTokens = useMemo(() => {
    if (chainSelection === "solana") {
      // From list: all tokens from wallet (portfolio API), not restricted to allowlist.
      const list = (solanaTokens ?? []) as any[];
      const rows = list
        .map((w: any) => {
          const mint = String(w?.address || "").trim();
          if (!mint) return null;
          const actualPrice = w?.price != null ? String(w.price) : null;
          const decimals = Number(w?.decimals ?? 0);
          const tokenInfo = solanaTokenInfoFromWalletToken({
            address: mint,
            name: String(w?.name || w?.symbol || mint),
            symbol: String(w?.symbol || "Unknown"),
            decimals: Number.isFinite(decimals) ? decimals : 0,
            logoUrl: w?.logoUrl || undefined,
          });
          return {
            address: mint,
            name: tokenInfo.name,
            symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals,
            amount: String(w?.amount ?? "0"),
            price: w?.price ?? null,
            tokenInfo,
            actualPrice,
          };
        })
        .filter(Boolean) as any[];

      // Sort by wallet USD value like Aptos list
      return rows.sort((a: any, b: any) => {
        const dec = (row: any) => row?.tokenInfo?.decimals ?? row?.decimals ?? 0;
        const aBalance = Number(a.amount || 0) / Math.pow(10, dec(a));
        const bBalance = Number(b.amount || 0) / Math.pow(10, dec(b));
        const aPrice = Number(a.actualPrice || 0);
        const bPrice = Number(b.actualPrice || 0);
        const aValueUSD = aBalance * aPrice;
        const bValueUSD = bBalance * bPrice;
        if (!isFinite(aValueUSD) && !isFinite(bValueUSD)) return 0;
        if (!isFinite(aValueUSD)) return 1;
        if (!isFinite(bValueUSD)) return -1;
        return bValueUSD - aValueUSD;
      });
    }
    return tokens
      .map(t => {
        const tokenInfo = getTokenInfo(t.address);
        // Use actual price from wallet only (no fallback to static prices)
        const actualPrice = t.price;
        return {
          ...t,
          tokenInfo,
          actualPrice
        };
      })
      .filter(token => token.tokenInfo)
      .sort((a, b) => {
        const dec = (t: any) => t?.tokenInfo?.decimals ?? t?.decimals ?? 8;
        const aUsd = (Number(a.amount) / Math.pow(10, dec(a))) * Number(a.actualPrice || 0);
        const bUsd = (Number(b.amount) / Math.pow(10, dec(b))) * Number(b.actualPrice || 0);
        return bUsd - aUsd;
      });
  }, [tokens, chainSelection, solanaTokens]);

  // Available tokens for "To" selection
  const availableToTokens = useMemo(() => {
    if (chainSelection === "solana") {
      const byMint = buildSolanaMintIndex(solanaTokens);
      const fromMint =
        fromToken && !("chainId" in (fromToken as any))
          ? solanaSwapMint(fromToken as any)
          : String((fromToken as any)?.faAddress || (fromToken as any)?.tokenAddress || "").toLowerCase();

      // 1) Wallet tokens first, excluding from token
      const walletRows = (solanaTokens ?? [])
        .map((w: any) => {
          const mint = String(w?.address || "").trim();
          if (!mint) return null;
          if (fromMint && mint.toLowerCase() === fromMint) return null;
          const actualPrice = w?.price != null ? String(w.price) : null;
          const decimals = Number(w?.decimals ?? 0);
          const tokenInfo = solanaTokenInfoFromWalletToken({
            address: mint,
            name: String(w?.name || w?.symbol || mint),
            symbol: String(w?.symbol || "Unknown"),
            decimals: Number.isFinite(decimals) ? decimals : 0,
            logoUrl: w?.logoUrl || undefined,
          });
          return {
            address: mint,
            name: tokenInfo.name,
            symbol: tokenInfo.symbol,
            decimals: tokenInfo.decimals,
            amount: String(w?.amount ?? "0"),
            price: w?.price ?? null,
            tokenInfo,
            actualPrice,
          };
        })
        .filter(Boolean) as any[];

      // 2) Default allowlist tokens after wallet tokens (dedupe by mint)
      const byAddr = new Map<string, any>();
      const put = (row: any) => {
        const addr = String(row?.tokenInfo?.faAddress || row?.tokenInfo?.tokenAddress || row?.address || "").toLowerCase();
        if (!addr) return;
        if (!byAddr.has(addr)) byAddr.set(addr, row);
      };
      walletRows.forEach(put);

      for (const stub of SOLANA_SWAP_TOKENS) {
        const mint = solanaSwapMint(stub);
        if (fromMint && mint === fromMint) continue;
        const w = byMint.get(mint);
        const actualPrice = w?.price != null ? String(w.price) : null;
        put({
          address: w?.address || stub.faAddress,
          name: stub.name,
          symbol: stub.symbol,
          decimals: stub.decimals,
          amount: w ? String(w.amount) : "0",
          price: w?.price ?? null,
          tokenInfo: solanaStubTokenInfo(stub),
          actualPrice,
        });
      }

      const rows = Array.from(byAddr.values());
      const isWalletToken = (row: any) => {
        const mint = String(row?.tokenInfo?.faAddress || row?.tokenInfo?.tokenAddress || row?.address || "").toLowerCase();
        return byMint.has(mint);
      };
      const dec = (row: any) => row?.tokenInfo?.decimals ?? row?.decimals ?? 0;
      const bal = (row: any) => Number(row.amount || 0) / Math.pow(10, dec(row));
      const usd = (row: any) => bal(row) * Number(row.actualPrice || 0);

      return rows.sort((a: any, b: any) => {
        const aw = isWalletToken(a);
        const bw = isWalletToken(b);
        if (aw !== bw) return aw ? -1 : 1;
        const ua = usd(a);
        const ub = usd(b);
        if (isFinite(ua) && isFinite(ub) && ub !== ua) return ub - ua;
        if (isFinite(ub) && !isFinite(ua)) return 1;
        if (isFinite(ua) && !isFinite(ub)) return -1;
        return String(a.symbol).localeCompare(String(b.symbol));
      });
    }
    // 1) Start with user's tokens (with tokenInfo attached)
    const userTokens = tokens
      .map(t => {
        const tokenInfo = getTokenInfo(t.address);
        // Use actual price from wallet only (no fallback to static prices)
        const actualPrice = t.price;
        return {
          ...t,
          tokenInfo,
          actualPrice
        };
      })
      .filter(token =>
        token.tokenInfo &&
        token.tokenInfo.faAddress !== fromToken?.faAddress
      )
      .sort((a, b) => Number(b.amount) - Number(a.amount));

    // 2) Ensure only native tokens are always present: APT, USDt, USDC (native), USD1, WBTC (native)
    // Native faAddresses (lowercase)
    const requiredFaAddresses = [
      '0xa', // APT
      '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b', // USDt (native)
      '0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b', // USDC (native)
      '0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2', // USD1 (native)
      '0x68844a0d7f2587e726ad0579f3d640865bb4162c08a4589eeda3f9689ec52a3d', // WBTC (native)
    ];

    const requiredTokens = (tokenList.data.data as Token[])
      .filter(token => requiredFaAddresses.includes((token.faAddress || '').toLowerCase()))
      .filter(token => token.faAddress !== fromToken?.faAddress)
      .map(token => ({
        address: token.faAddress || token.tokenAddress || '',
        name: token.name || token.symbol,
        symbol: token.symbol,
        decimals: token.decimals,
        amount: '0',
        price: null as string | null,
        tokenInfo: token,
        actualPrice: null // No price for tokens not in wallet
      }));

    // 3) Merge with deduplication by token address
    const byAddr = new Map<string, any>();
    const put = (item: any) => {
      const addr = (item.tokenInfo?.faAddress || item.tokenInfo?.tokenAddress || item.address || '').toLowerCase();
      if (!addr) return;
      if (!byAddr.has(addr)) byAddr.set(addr, item);
    };

    userTokens.forEach(put);
    requiredTokens.forEach(put);

    return Array.from(byAddr.values());
  }, [tokens, fromToken, chainSelection, solanaTokens]);

  // Type guard to check if token has tokenInfo property
  const hasTokenInfo = (token: any): token is { tokenInfo: Token; value: number; address: string; name: string; symbol: string; decimals: number; amount: string; price: string | null; actualPrice?: string | null } => {
    return 'tokenInfo' in token && token.tokenInfo !== undefined;
  };

  const pickListRowDecimals = (row: any): number => {
    return row?.tokenInfo?.decimals ?? row?.decimals ?? 8;
  };

  const isSolanaStubToken = (t: SwapToken | null | undefined): t is SolanaTokenStub => {
    return Boolean(t && !("chainId" in (t as any)) && typeof (t as any).tokenAddress === "string");
  };

  function getTokenInfo(address: string): Token | undefined {
    // Normalize addresses by removing leading zeros after 0x
    const normalizeAddress = (addr: string) => {
      if (!addr || !addr.startsWith('0x')) return addr;
      return '0x' + addr.slice(2).replace(/^0+/, '') || '0x0';
    };

    const normalizedAddress = normalizeAddress(address);

    return (tokenList.data.data as Token[]).find(token => {
      const normalizedTokenAddress = normalizeAddress(token.tokenAddress || '');
      const normalizedFaAddress = normalizeAddress(token.faAddress || '');

      return normalizedTokenAddress === normalizedAddress ||
             normalizedFaAddress === normalizedAddress;
    });
  }

  function normalizeAddress(address?: string) {
    return (address || '').toLowerCase();
  }

  function findTokenBalance(tokens: any[], token: Token): string {
    const tokenAddresses = [
      token.tokenAddress ?? undefined,
      token.faAddress ?? undefined,
    ].filter(Boolean).map(normalizeAddress);

    const found = tokens.find(
      t =>
        tokenAddresses.includes(normalizeAddress(t.address)) ||
        tokenAddresses.includes(normalizeAddress(t.faAddress))
    );

    return found?.amount || '0';
  }

  // Refresh portfolio data when modal opens
  useEffect(() => {
    if (isOpen) {
      console.log('[SwapModal] Refreshing portfolio data on modal open');
      refreshPortfolio();
      void refreshSolanaPortfolio();
    }
  }, [isOpen, refreshPortfolio, refreshSolanaPortfolio]);

  // Apply prefilled route (hedge / deep links) when opening with prefill
  useEffect(() => {
    if (!isOpen || !prefill?.fromFaAddress || !prefill?.toFaAddress) return;
    const fromT = getTokenInfo(prefill.fromFaAddress);
    const toT = getTokenInfo(prefill.toFaAddress);
    if (!fromT || !toT) return;
    const fromAddr = fromT.faAddress ?? fromT.tokenAddress ?? undefined;
    const toAddr = toT.faAddress ?? toT.tokenAddress ?? undefined;
    const fromPx = walletPriceForFa(fromAddr);
    const toPx = walletPriceForFa(toAddr);
    setFromToken({ ...fromT, actualPrice: fromPx ?? undefined });
    setToToken({ ...toT, actualPrice: toPx ?? undefined });
    setAmount(prefill.amount ?? '');
    prefillRequestedAmountRef.current = prefill.amount ?? '';
    autoClampedFromPrefillRef.current = false;
    setSwapQuote(null);
    setQuoteDebug(null);
    setSwapResult(null);
    setError(null);
    prefillSessionRef.current = true;
  }, [isOpen, prefill, tokens]);

  // Reset token state after closing a session that used prefill (ChatPanel unchanged)
  useEffect(() => {
    if (isOpen || !prefillSessionRef.current) return;
    setFromToken(null);
    setToToken(null);
    setAmount('');
    prefillRequestedAmountRef.current = '';
    autoClampedFromPrefillRef.current = false;
    setSwapQuote(null);
    setQuoteDebug(null);
    setSwapResult(null);
    setError(null);
    prefillSessionRef.current = false;
  }, [isOpen]);

  // Set default tokens on load (skip when prefill drives the session)
  useEffect(() => {
    if (!isOpen) return;
    if (chainSelection !== "aptos") return;
    if (prefill?.fromFaAddress && prefill?.toFaAddress) return;
    if (availableTokens.length > 0 && !fromToken) {
      const firstToken = availableTokens[0];
      const token = getTokenInfo((firstToken as any).address);
      if (token) {
        setFromToken({ ...token, actualPrice: firstToken.actualPrice });
      }
    }

    if (availableToTokens.length > 0 && !toToken) {
      const secondToken = availableToTokens[1] || availableToTokens[0];
      if (hasTokenInfo(secondToken)) {
        setToToken({ ...secondToken.tokenInfo, actualPrice: secondToken.actualPrice });
      } else {
        setToToken({ ...(secondToken as Token), actualPrice: secondToken.actualPrice });
      }
    }
  }, [isOpen, chainSelection, prefill, availableTokens, availableToTokens, fromToken, toToken, tokens]);

  const registryByFa = useMemo(() => {
    const m = new Map<string, (typeof TOKEN_REGISTRY)[number]>();
    for (const t of TOKEN_REGISTRY) {
      if (t.chain !== "aptos") continue;
      if (t.addresses.faAddress) m.set(String(t.addresses.faAddress).toLowerCase(), t);
    }
    return m;
  }, []);

  const registryByMint = useMemo(() => {
    const m = new Map<string, (typeof TOKEN_REGISTRY)[number]>();
    for (const t of TOKEN_REGISTRY) {
      if (t.chain !== "solana") continue;
      if (t.addresses.mint) m.set(String(t.addresses.mint).toLowerCase(), t);
    }
    return m;
  }, []);

  const registryForSwapToken = (t: SwapToken | null | undefined) => {
    if (!t) return null;
    if ("chainId" in (t as any)) {
      const fa = String((t as any).faAddress || (t as any).tokenAddress || "").toLowerCase();
      return registryByFa.get(fa) ?? null;
    }
    const mint = solanaSwapMint(t as any);
    return registryByMint.get(mint) ?? null;
  };

  // Auto-fetch quote: Debounced for amount changes (600ms delay)
  useEffect(() => {
    // Validate all required fields
    if (!fromToken || !toToken || !amount || parseFloat(amount) <= 0) return;
    if (chainSelection === "aptos" && !userAddress) return;
    if (chainSelection === "solana" && !solanaTakerAddress) return;

    // Debounce: wait 600ms after user stops typing
    const timer = setTimeout(() => {
      getQuote();
    }, 600);

    return () => clearTimeout(timer);
  }, [amount, chainSelection]); // Only trigger on amount change

  // Auto-fetch quote: Fast reaction for token changes (100ms delay)
  useEffect(() => {
    // Validate all required fields
    if (!fromToken || !toToken || !amount || parseFloat(amount) <= 0) return;
    if (chainSelection === "aptos" && !userAddress) return;
    if (chainSelection === "solana" && !solanaTakerAddress) return;

    // Small delay to avoid aggressive requests
    const timer = setTimeout(() => {
      getQuote();
    }, 100);

    return () => clearTimeout(timer);
  }, [fromToken, toToken, slippage, chainSelection]); // Trigger on token or slippage change

  const getQuote = async () => {
    if (chainSelection !== "aptos") {
      // Solana quote
      if (!fromToken || !toToken || !amount || parseFloat(amount) <= 0) {
        setError("Please select tokens and enter amount");
        return;
      }
      if (!solanaTakerAddress) {
        setError("Solana wallet not connected. Please connect your Solana wallet first.");
        return;
      }
      setLoading(true);
      setError(null);
      setSwapQuote(null);
      setQuoteDebug(null);
      setSwapResult(null);
      try {
        const decimals = fromToken.decimals ?? 9;
        const amt = Number(amount);
        const baseUnits = BigInt(Math.floor(amt * Math.pow(10, decimals))).toString();
        const res = await fetch(gaslessSwapEnabled ? "/api/jupiter/quote" : "/api/jupiter/quoteV1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputMint: fromToken.tokenAddress || fromToken.faAddress,
            outputMint: toToken.tokenAddress || toToken.faAddress,
            amount: baseUnits,
            slippageBps: Math.floor(slippage * 100),
            ...(gaslessSwapEnabled ? { taker: solanaTakerAddress } : {}),
          }),
        });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || `Quote failed: ${res.status}`);
        }
        const q = await res.json();
        setQuoteDebug(q);
        const outDecimals = toToken.decimals ?? 6;
        const outHuman = baseUnitsToDecimalString(String(q.outAmount || "0"), outDecimals);
        setSwapQuote({
          amount: outHuman,
          path: [],
          estimatedFromAmount: amount,
          estimatedToAmount: outHuman,
        });
        setLastQuoteData({ fromToken, toToken, amount, slippage });
      } catch (e: any) {
        setError(`Quote error: ${e?.message || e}`);
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!fromToken || !toToken || !amount || parseFloat(amount) <= 0 || !userAddress) {
      setError('Please select tokens, enter amount, and connect wallet');
      return;
    }

    setLoading(true);
    setError(null);
    setSwapQuote(null);
    setQuoteDebug(null);
    setSwapResult(null); // Clear previous swap result

    // Используем готовые цены из tokens кошелька - не нужно загружать свежие цены
    // Цены уже актуальные и загружены при открытии приложения

    try {
      const humanReadableAmount = amount;

      const response = await fetch('/api/panora/swap-quote', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chainId: "1",
          fromTokenAddress: fromToken.faAddress || fromToken.tokenAddress || '',
          toTokenAddress: toToken.faAddress || toToken.tokenAddress || '',
          fromTokenAmount: humanReadableAmount,
          toWalletAddress: userAddress,
          slippagePercentage: slippage.toString(),
          getTransactionData: "transactionPayload"
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get quote');
      }

      const quoteData = await response.json();
      setQuoteDebug(quoteData);
      console.log('Panora swap quote:', quoteData);

      const quote = quoteData.quotes?.[0];
      const toTokenAmount = quote?.toTokenAmount || '0';

      setSwapQuote({
        amount: toTokenAmount,
        path: quoteData.route || quoteData.path || [],
        estimatedFromAmount: humanReadableAmount,
        estimatedToAmount: toTokenAmount,
      });

      // Сохраняем данные для отслеживания изменений
      setLastQuoteData({
        fromToken,
        toToken,
        amount,
        slippage
      });

    } catch (error: any) {
      setError(`Quote error: ${error.message || error}`);
    } finally {
      setLoading(false);
    }
  };

  const executeSwap = async () => {
    if (chainSelection !== "aptos") {
      // Solana execute:
      // - gaslessSwapEnabled=true: server-side fee payer (existing flow)
      // - otherwise: user pays gas via their wallet (Jupiter swap tx fee payer = user)
      if (!solanaCanSign || !solanaTakerAddress) {
        setError("Solana wallet not connected. Please connect your Solana wallet first.");
        return;
      }
      if (!fromToken || !toToken || !amount || parseFloat(amount) <= 0) {
        setError("Please select tokens and enter amount");
        return;
      }
      setLoading(true);
      setError(null);
      setSwapResult(null);
      try {
        const decimals = fromToken.decimals ?? 9;
        const amt = Number(amount);
        const baseUnits = BigInt(Math.floor(amt * Math.pow(10, decimals))).toString();

        if (!gaslessSwapEnabled) {
          if (!solanaConnection) {
            throw new Error("Solana connection not available");
          }
          if (!quoteDebug) {
            throw new Error("Missing Jupiter quote (get quote first)");
          }
          console.log("[SwapModal:solana] executeSwap (user gas)", {
            taker: solanaTakerAddress,
            inputMint: fromToken.tokenAddress || fromToken.faAddress,
            outputMint: toToken.tokenAddress || toToken.faAddress,
            amountUi: amount,
            amountBaseUnits: baseUnits,
            slippageBps: Math.floor(slippage * 100),
          });
          const swapRes = await fetch("/api/jupiter/swapTx", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userPublicKey: solanaTakerAddress,
              quoteResponse: quoteDebug,
              wrapAndUnwrapSol: true,
            }),
          });
          if (!swapRes.ok) {
            const t = await swapRes.text().catch(() => "");
            console.error("[SwapModal:solana] Jupiter /swap failed", { status: swapRes.status, body: t });
            throw new Error(t || `Jupiter swap build failed: ${swapRes.status}`);
          }
          const swapJson = await swapRes.json();
          const swapTxB64 = String(swapJson?.swapTransaction || "").trim();
          if (!swapTxB64) throw new Error("Jupiter swap response missing swapTransaction");

          const { VersionedTransaction } = await import("@solana/web3.js");
          const tx = VersionedTransaction.deserialize(Buffer.from(swapTxB64, "base64"));
          const signTx = solanaResolved.signTx;
          if (!signTx) throw new Error("Wallet does not support signTransaction");
          const signed = await signTx(tx);
          let sig = "";
          try {
            sig = await solanaConnection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
            await solanaConnection.confirmTransaction(sig, "confirmed");
          } catch (sendErr) {
            console.error("[SwapModal:solana] send/confirm failed", sendErr);
            throw sendErr;
          }

          try {
            await refreshSolanaPortfolio();
          } catch {}
          try {
            if (typeof window !== "undefined") {
              window.dispatchEvent(new CustomEvent("solana-portfolio:refresh", { detail: { address: solanaTakerAddress } }));
            }
          } catch {}

          setSwapResult({
            success: true,
            hash: sig,
            receivedAmount: swapQuote?.amount,
            receivedSymbol: toToken.symbol,
          });
          setSwapQuote(null);
          setQuoteDebug(null);
          setLastQuoteData({ fromToken: null, toToken: null, amount: "", slippage: 0.5 });
          return;
        }

        const buildRes = await fetch("/api/jupiter/build", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            inputMint: fromToken.tokenAddress || fromToken.faAddress,
            outputMint: toToken.tokenAddress || toToken.faAddress,
            amount: baseUnits,
            taker: solanaTakerAddress,
            slippageBps: Math.floor(slippage * 100),
          }),
        });
        if (!buildRes.ok) {
          const t = await buildRes.text();
          console.error("[SwapModal:solana] /api/jupiter/build failed", { status: buildRes.status, body: t });
          throw new Error(t || `Build failed: ${buildRes.status}`);
        }
        const build = await buildRes.json();

        const signTx = solanaResolved.signTx;
        if (!signTx) {
          setError("Solana wallet not connected. Please connect your Solana wallet first.");
          return;
        }

        const { VersionedTransaction } = await import("@solana/web3.js");
        const tx = VersionedTransaction.deserialize(Buffer.from(build.transaction, "base64"));
        const signed = await signTx(tx);
        const signedBase64 = Buffer.from(signed.serialize()).toString("base64");

        const execRes = await fetch("/api/jupiter/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signedTransaction: signedBase64,
            lastValidBlockHeight: build.lastValidBlockHeight,
          }),
        });
        if (!execRes.ok) {
          const t = await execRes.text();
          console.error("[SwapModal:solana] /api/jupiter/execute failed", { status: execRes.status, body: t });
          throw new Error(t || `Execute failed: ${execRes.status}`);
        }
        const result = await execRes.json();
        if (result.status === "Success") {
          // Refresh Solana portfolio (sidebar balances/prices) after swap.
          try {
            await refreshSolanaPortfolio();
          } catch {}
          // Trigger refresh for other hook instances (e.g. Sidebar) that have their own local state.
          try {
            if (typeof window !== "undefined") {
              window.dispatchEvent(
                new CustomEvent("solana-portfolio:refresh", { detail: { address: solanaTakerAddress } }),
              );
            }
          } catch {}
          // Keep Aptos portfolio up to date too (some UIs rely on shared refresh on modal close).
          try {
            await refreshPortfolio();
          } catch {}
        }
        setSwapResult({
          success: result.status === "Success",
          hash: result.signature,
          receivedAmount: swapQuote?.amount,
          receivedSymbol: toToken.symbol,
        });
        setSwapQuote(null);
        setQuoteDebug(null);
        setLastQuoteData({ fromToken: null, toToken: null, amount: "", slippage: 0.5 });
      } catch (e: any) {
        console.error("[SwapModal:solana] executeSwap failed", {
          gaslessSwapEnabled,
          taker: solanaTakerAddress,
          from: {
            symbol: fromToken?.symbol,
            mint: (fromToken as any)?.tokenAddress || (fromToken as any)?.faAddress,
            decimals: (fromToken as any)?.decimals,
          },
          to: {
            symbol: toToken?.symbol,
            mint: (toToken as any)?.tokenAddress || (toToken as any)?.faAddress,
            decimals: (toToken as any)?.decimals,
          },
          amountUi: amount,
          slippage,
          error: e,
          message: e?.message || String(e),
        });
        setSwapResult({ success: false, error: e?.message || String(e) });
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!connected) {
      setError('Wallet not connected. Please connect your wallet first.');
      return;
    }

    if (!fromToken || !toToken || !amount || !swapQuote || !userAddress || !quoteDebug) {
      const missing = [];
      if (!fromToken) missing.push('fromToken');
      if (!toToken) missing.push('toToken');
      if (!amount) missing.push('amount');
      if (!swapQuote) missing.push('swapQuote');
      if (!userAddress) missing.push('userAddress');
      if (!quoteDebug) missing.push('quoteDebug');

      setError(`Missing required data for swap: ${missing.join(', ')}`);
      return;
    }

    setLoading(true);
    setError(null);
    setSwapResult(null);

    try {
      const requestBody = {
        quoteData: quoteDebug,
        walletAddress: userAddress
      };

      const response = await fetch('/api/panora/execute-swap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to execute swap');
      }

      const swapData = await response.json();

      if (swapData.error) {
        throw new Error(swapData.error);
      }

      if (swapData && !swapData.error) {
        try {
          const txPayload = swapData;

          console.log('Transaction payload received:', txPayload);
          console.log('Function:', txPayload.function);
          console.log('Type arguments:', txPayload.type_arguments);
          console.log('Arguments:', txPayload.arguments);

          if (!txPayload.function || !txPayload.type_arguments || !txPayload.arguments) {
            console.error('Missing required fields in payload:', {
              function: !!txPayload.function,
              type_arguments: !!txPayload.type_arguments,
              arguments: !!txPayload.arguments
            });
            throw new Error('Invalid transaction payload structure');
          }

          // Ensure arguments is an array
          if (!Array.isArray(txPayload.arguments)) {
            console.error('Arguments is not an array:', txPayload.arguments);
            throw new Error('Transaction payload arguments must be an array');
          }

          const typeArguments = Array.isArray(txPayload.type_arguments) ? txPayload.type_arguments : [];
          const functionArguments = txPayload.arguments;

          console.log('Processed type arguments:', typeArguments);
          console.log('Function arguments (as is):', functionArguments);

          console.log('Executing swap via signAndSubmitTransaction with Gas Station...');

          // Use signAndSubmitTransaction with global Gas Station transactionSubmitter from WalletProvider
          // Gas Station will automatically sponsor the transaction (free for user)
          if (!connected || !signAndSubmitTransaction) {
            throw new Error('Wallet not connected');
          }

          const tx = await signAndSubmitTransaction({
            data: {
              function: txPayload.function as `${string}::${string}::${string}`,
              typeArguments: typeArguments,
              functionArguments: functionArguments
            },
            options: {
              maxGasAmount: 20000,
            }
          });

          setSwapResult({
            success: true,
            hash: tx.hash || 'Transaction submitted successfully',
            receivedAmount: quoteDebug?.quotes?.[0]?.toTokenAmount || swapQuote.amount,
            receivedSymbol: toToken.symbol,
          });

          // Сбрасываем quote после успешного выполнения
          setSwapQuote(null);
          setQuoteDebug(null);
          setLastQuoteData({
            fromToken: null,
            toToken: null,
            amount: '',
            slippage: 0.5
          });

          // Optimistically update UI balances and clear amount
          try {
            const fromKey = (fromToken.faAddress || fromToken.tokenAddress || '').toLowerCase();
            const toKey = (toToken.faAddress || toToken.tokenAddress || '').toLowerCase();

            const currentFrom = getTokenBalance(fromToken).balance;
            const currentTo = getTokenBalance(toToken).balance;

            const spent = Number(amount || '0');
            const received = Number(quoteDebug?.quotes?.[0]?.toTokenAmount || swapQuote.amount || '0');

            const next: Record<string, number> = { ...balancesOverride };
            if (fromKey) next[fromKey] = Math.max(0, (currentFrom - spent));
            if (toKey) next[toKey] = Math.max(0, (currentTo + received));
            setBalancesOverride(next);

            setAmount('');
          } catch {}
        } catch (walletError: any) {
          let errorMessage = 'Failed to sign transaction';
          if (walletError.message) {
            errorMessage = walletError.message;
          } else if (walletError.name === 'PetraApiError') {
            errorMessage = 'Petra wallet error. Please check your wallet connection and try again.';
          } else if (isUserRejectedError(walletError)) {
            errorMessage = 'Transaction was rejected by user.';
          } else if (walletError.code === 'WALLET_NOT_CONNECTED') {
            errorMessage = 'Wallet not connected. Please connect your wallet first.';
          } else if (walletError.code === 'WALLET_LOCKED') {
            errorMessage = 'Wallet is locked. Please unlock your wallet and try again.';
          }

          setSwapResult({
            success: false,
            error: errorMessage,
          });
        }
      } else {
        setSwapResult({
          success: false,
          error: swapData.error || 'Failed to build transaction',
        });
      }

    } catch (error: any) {
      const errorMessage = error.message || error;
      if (errorMessage.includes('E_OUTPUT_LESS_THAN_MINIMUM') || errorMessage.includes('TRY_INCREASING_SLIPPAGE')) {
        setSwapResult({
          success: false,
          error: `Slippage too low. Try increasing slippage from ${slippage}% to ${Math.min(slippage + 1, 5)}% or higher. Error: ${errorMessage}`,
        });
      } else {
        setSwapResult({
          success: false,
          error: errorMessage,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (num: number | string) => {
    return Number(num).toLocaleString('en-US', { maximumFractionDigits: 2 });
  };

  const formatReceivedAmount = (num: number | string) => {
    const n = Number(num);
    if (!Number.isFinite(n)) return String(num);
    return n.toLocaleString('en-US', { maximumFractionDigits: 5 });
  };

  // Убираем formatUSD - он больше не используется
  // const formatUSD = (num: number | string) => { ... };

  // Убираем функцию getTokenPrice - она больше не используется
  // const getTokenPrice = (token: Token) => { ... };

  // Проверяем, изменились ли данные с момента получения quote
  const hasDataChanged = () => {
    if (!lastQuoteData.fromToken || !lastQuoteData.toToken) return true;

    return (
      lastQuoteData.fromToken.faAddress !== fromToken?.faAddress ||
      lastQuoteData.toToken.faAddress !== toToken?.faAddress ||
      lastQuoteData.amount !== amount ||
      lastQuoteData.slippage !== slippage
    );
  };

  const hasPositiveAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0;
  }, [amount]);

  // Fetch prices for Solana tokens not currently in wallet
  useEffect(() => {
    if (chainSelection !== "solana") return;
    const mints = [fromToken, toToken]
      .filter(Boolean)
      .filter((t) => !("chainId" in (t as any)))
      .map((t) => solanaSwapMint(t as any))
      .filter((m) => {
        if (!m) return false;
        if (fetchedPrices[m]) return false;
        const inWallet = (solanaTokens ?? []).find(
          (w: any) => String(w?.address || "").toLowerCase() === m && w?.price != null
        );
        return !inWallet;
      });
    if (!mints.length) return;
    fetch(`https://api.jup.ag/price/v2?ids=${mints.join(",")}`)
      .then((r) => r.json())
      .then((data: any) => {
        const next: Record<string, string> = {};
        for (const [id, info] of Object.entries(data?.data ?? {})) {
          const p = (info as any)?.price;
          if (p != null) next[id.toLowerCase()] = String(p);
        }
        if (Object.keys(next).length) setFetchedPrices((prev) => ({ ...prev, ...next }));
      })
      .catch(() => {});
  }, [fromToken, toToken, chainSelection]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPercent = (pct: number) => {
    if (!fromToken) return;
    const maxVal = maxSpendableHuman(fromToken);
    const val = maxVal * pct / 100;
    setAmount(val > 0 ? formatHumanAmount(val, fromToken.decimals ?? 8) : "");
    setSwapQuote(null);
    setQuoteDebug(null);
    setSwapResult(null);
    setLastQuoteData({ fromToken: null, toToken: null, amount: "", slippage: 0.5 });
  };

  const formatRate = (n: number): string => {
    if (!Number.isFinite(n) || n === 0) return "0";
    if (n >= 1000) return formatNumber(n);
    if (n >= 1) return n.toFixed(4).replace(/\.?0+$/, "");
    return n.toPrecision(4).replace(/\.?0+$/, "");
  };

  // Получаем конфигурацию кнопки
  const getButtonConfig = () => {
    if (!swapQuote || hasDataChanged()) {
      return {
        text: 'Get Quote',
        action: getQuote,
        disabled:
          !fromToken ||
          !toToken ||
          !hasPositiveAmount ||
          (chainSelection === "solana"
            ? !solanaTakerAddress
            : !userAddress),
        variant: 'default' as const
      };
    }

    return {
      text: 'Execute Swap',
      action: executeSwap,
      disabled: chainSelection === "solana" ? !solanaCanSign : false,
      variant: 'default' as const
    };
  };

  const getTokenBalance = (token: any) => {
    if (chainSelection === "solana") {
      const addr = String(token?.tokenAddress || token?.faAddress || token?.address || "").toLowerCase();
      if (!addr) return { balance: 0 };
      const list = solanaTokens ?? [];
      const byAddr = list.find((x: any) => String(x?.address || "").toLowerCase() === addr);
      const bySymbol =
        !byAddr && token?.symbol
          ? list.find((x: any) => String(x?.symbol || "").toUpperCase() === String(token.symbol).toUpperCase())
          : null;
      const t = byAddr || bySymbol;
      if (!t) return { balance: 0 };
      const rawAmount = Number(t.amount);
      const decimals = Number(t.decimals ?? token?.decimals ?? 9);
      if (!Number.isFinite(rawAmount) || !Number.isFinite(decimals)) return { balance: 0 };
      const human = rawAmount / Math.pow(10, decimals);
      return { balance: Number.isFinite(human) ? human : 0 };
    }
    const balance = findTokenBalance(tokens, token);
    const humanBalance = Number(balance) / Math.pow(10, token.decimals);

    const key = (token.faAddress || token.tokenAddress || '').toLowerCase();
    const override = key ? balancesOverride[key] : undefined;
    const effective = typeof override === 'number' ? override : humanBalance;

    return { balance: effective };
  };

  const formatHumanAmount = (val: number, decimals: number) => {
    if (!Number.isFinite(val) || val <= 0) return '';
    const maxDp = Math.min(Math.max(decimals, 0), 8);
    const s = val.toFixed(maxDp).replace(/\.?0+$/, '');
    return s || '';
  };

  function baseUnitsToDecimalString(raw: string, decimals: number) {
    try {
      const d = Math.max(0, Math.min(Number(decimals) || 0, 18));
      const neg = raw.startsWith("-");
      const digits = (neg ? raw.slice(1) : raw).replace(/^0+/, "") || "0";
      if (d === 0) return (neg ? "-" : "") + digits;
      const padded = digits.padStart(d + 1, "0");
      const intPart = padded.slice(0, -d) || "0";
      const fracPartRaw = padded.slice(-d);
      const fracPart = fracPartRaw.replace(/0+$/, "");
      return (neg ? "-" : "") + intPart + (fracPart ? "." + fracPart : "");
    } catch {
      return "0";
    }
  }

  const maxSpendableHuman = (token: SwapToken) => {
    const bal = getTokenBalance(token).balance;
    if (chainSelection === "solana") {
      // Gasless payer covers network fees, but SOL wrapping/rounding can still be finicky.
      const isSol = String((token as any)?.symbol || "").toUpperCase() === "SOL";
      const dust = isSol ? 0.00001 : 0;
      return Math.max(0, bal - dust);
    }
    const dec = token.decimals ?? 8;
    // Safety dust to avoid rounding/precision issues; at least 2 base units.
    const units = Math.max(2, 1);
    const dust = units * Math.pow(10, -Math.min(dec, 8));
    return Math.max(0, bal - dust);
  };

  const amountNum = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) ? n : NaN;
  }, [amount]);

  const fromBal = useMemo(() => {
    if (!fromToken) return null;
    return getTokenBalance(fromToken).balance;
  }, [fromToken, tokens, balancesOverride, solanaTokens, chainSelection]);

  const insufficient = useMemo(() => {
    if (!fromToken || fromBal == null) return null;
    if (!Number.isFinite(amountNum) || amountNum <= 0) return null;
    const need = amountNum;
    const have = fromBal;
    const eps = 1e-12;
    if (need <= have + eps) return null;
    const deficit = need - have;
    const deficitRatio = need > 0 ? deficit / need : 1;
    return { need, have, deficit, deficitRatio };
  }, [fromToken, fromBal, amountNum]);

  // Prefill UX: if we're slightly short, auto-clamp to max available and show amber hint.
  useEffect(() => {
    if (!isOpen) return;
    if (chainSelection !== "aptos") return;
    if (!prefillSessionRef.current) return;
    if (autoClampedFromPrefillRef.current) return;
    if (!fromToken) return;
    if (!insufficient) return;
    // "Slightly short": <= 0.1%
    if (insufficient.deficitRatio > 0.001) return;
    const maxVal = maxSpendableHuman(fromToken);
    const next = formatHumanAmount(maxVal, fromToken.decimals ?? 8);
    if (!next) return;
    autoClampedFromPrefillRef.current = true;
    setAmount(next);
    setSwapQuote(null);
    setQuoteDebug(null);
    setSwapResult(null);
    setLastQuoteData({
      fromToken: null,
      toToken: null,
      amount: '',
      slippage: 0.5,
    });
  }, [isOpen, fromToken, insufficient]);

  const getHumanAmount = (raw: string | undefined, decimals: number | undefined) => {
    if (!raw || !decimals) return 0;
    return Number(raw) / Math.pow(10, decimals);
  };

  const formatHash = (hash: string) => {
    if (hash.length <= 12) return hash;
    return `${hash.slice(0, 6)}...${hash.slice(-6)}`;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // Можно добавить toast уведомление здесь
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const openExplorer = (hash: string) => {
    const explorerUrl =
      chainSelection === "solana"
        ? `https://solscan.io/tx/${encodeURIComponent(hash)}`
        : `https://explorer.aptoslabs.com/txn/${hash}?network=mainnet`;
    window.open(explorerUrl, '_blank');
  };

  const swapTokens = () => {
    if (fromToken && toToken) {

      setFromToken(toToken);
      setToToken(fromToken);

      // Если есть quote, используем количество получаемых токенов как новое количество
      if (swapQuote && quoteDebug?.quotes?.[0]?.toTokenAmount) {
        setAmount(quoteDebug.quotes[0].toTokenAmount);
      } else {
        setAmount('');
      }

      setSwapQuote(null);
      setQuoteDebug(null);
      setError(null);
      setSwapResult(null); // Clear swap result when swapping tokens
      // Сбрасываем данные для отслеживания изменений
      setLastQuoteData({
        fromToken: null,
        toToken: null,
        amount: '',
        slippage: 0.5
      });
    }
  };

  const openTokenPicker = (side: "from" | "to") => {
    setTokenPickerOpenFor(side);
    setTokenPickerQuery("");
    setTokenPickerTab("all");
  };

  const closeTokenPicker = () => {
    setTokenPickerOpenFor(null);
    setTokenPickerQuery("");
    setTokenPickerTab("all");
  };

  const pickerUniverse = useMemo(() => {
    const q = tokenPickerQuery.trim().toLowerCase();
    const chain = chainSelection;

    const reg = TOKEN_REGISTRY.filter((t) => t.chain === chain);

    const wallet = (() => {
      if (chain === "solana") {
        return (availableTokens ?? [])
          .map((row: any) => {
            const tokenInfo = row?.tokenInfo as Token | undefined;
            if (!tokenInfo) return null;
            const mintRaw = String(tokenInfo.faAddress || tokenInfo.tokenAddress || row?.address || "").trim();
            const mintKey = mintRaw.toLowerCase();
            const match = registryByMint.get(mintKey) ?? null;
            return {
              kind: "wallet" as const,
              chain,
              symbol: String(tokenInfo.symbol || row?.symbol || "Unknown"),
              name: String(tokenInfo.name || row?.name || ""),
              decimals: Number(tokenInfo.decimals ?? row?.decimals ?? 0),
              logoUrl: String(tokenInfo.logoUrl || row?.logoUrl || "/file.svg"),
              tags: (match?.tags ?? []) as any[],
              id: `solana:${mintKey || String(row?.address || "").trim()}`,
              mint: mintRaw,
              amount: row?.amount ?? "0",
              actualPrice: row?.actualPrice ?? null,
            };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x));
      }

      return (availableTokens ?? [])
        .map((row: any) => {
          const tokenInfo = row?.tokenInfo as Token | undefined;
          if (!tokenInfo) return null;
          const fa = String(tokenInfo.faAddress || tokenInfo.tokenAddress || row?.address || "").toLowerCase();
          const match = registryByFa.get(fa) ?? null;
          return {
            kind: "wallet" as const,
            chain,
            symbol: String(tokenInfo.symbol || row?.symbol || "Unknown"),
            name: String(tokenInfo.name || row?.name || ""),
            decimals: Number(tokenInfo.decimals ?? row?.decimals ?? 0),
            logoUrl: String(tokenInfo.logoUrl || row?.logoUrl || "/file.svg"),
            tags: (match?.tags ?? []) as any[],
            id: `aptos:${fa || (row?.address || "")}`,
            faAddress: fa,
            amount: row?.amount ?? "0",
            actualPrice: row?.actualPrice ?? null,
          };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));
    })();

    const walletAddressSet = new Set<string>(
      wallet
        .map((w: any) => (chain === "solana" ? w?.mint : w?.faAddress))
        .map((x: any) => String(x || "").toLowerCase())
        .filter(Boolean)
    );

    // "Other tokens" must not duplicate wallet entries.
    const other = reg
      .map((t) => ({
        kind: "registry" as const,
        chain,
        symbol: t.symbol,
        name: t.name,
        decimals: t.decimals,
        logoUrl: String(t.logoUrl || "/file.svg"),
        tags: t.tags,
        id: t.id,
        faAddress: t.addresses.faAddress ? String(t.addresses.faAddress).toLowerCase() : undefined,
        mint: t.addresses.mint ? String(t.addresses.mint).trim() : undefined,
      }))
      .filter((r) => {
        const key = String((chain === "solana" ? r.mint : r.faAddress) || "").toLowerCase();
        if (!key) return false;
        return !walletAddressSet.has(key);
      });

    const merged = [...wallet, ...other];
    const filtered = merged.filter((t) => {
      if (!q) return true;
      return String(t.symbol).toLowerCase().includes(q) || String(t.name).toLowerCase().includes(q);
    });

    const tabFiltered =
      tokenPickerTab === "all"
        ? filtered
        : filtered.filter((t) => Array.isArray(t.tags) && (t.tags as any[]).includes(tokenPickerTab));

    const counts = ((): Record<TokenPickerTab, number> => {
      const base = filtered;
      const c: Record<TokenPickerTab, number> = {
        all: base.length,
        stablecoin: 0,
        lst: 0,
        xStocks: 0,
        l1: 0,
      };
      for (const t of base) {
        for (const tag of t.tags ?? []) {
          if (tag in c) (c as any)[tag] += 1;
        }
      }
      return c;
    })();

    return { wallet, other, rows: tabFiltered, counts };
  }, [
    tokenPickerQuery,
    tokenPickerTab,
    chainSelection,
    availableTokens,
    registryByFa,
    registryByMint,
  ]);

  const applyPickedToken = (side: "from" | "to", picked: any) => {
    if (chainSelection === "solana") {
      const mintRaw = String(picked.mint || "").trim();
      const mintKey = mintRaw.toLowerCase();
      const walletRow = (availableTokens ?? []).find((t: any) => {
        const addr = String(t?.tokenInfo?.faAddress || t?.tokenInfo?.tokenAddress || t?.address || "").toLowerCase();
        return addr && mintKey && addr === mintKey;
      });

      const tokenInfo: Token | undefined =
        walletRow?.tokenInfo ??
        (picked.logoUrl || picked.symbol
          ? solanaStubTokenInfo({
              tokenAddress: mintRaw,
              faAddress: mintRaw,
              name: picked.name,
              symbol: picked.symbol,
              decimals: picked.decimals,
              logoUrl: picked.logoUrl || "/file.svg",
            })
          : undefined);

      if (!tokenInfo) return;
      const stub = solanaStubFromTokenInfo(tokenInfo, walletRow?.actualPrice ?? null);
      if (side === "from") setFromToken(stub);
      else setToToken(stub);
    } else {
      const fa = String(picked.faAddress || "").toLowerCase();
      const token = fa ? getTokenInfo(fa) : undefined;
      if (!token) return;
      const walletRow = (availableTokens ?? []).find((t: any) => {
        const addr = String(t?.tokenInfo?.faAddress || t?.tokenInfo?.tokenAddress || t?.address || "").toLowerCase();
        return addr && fa && addr === fa;
      });
      // Fallback to Panora's usdPrice when token is not in wallet
      const priceFromList = token.usdPrice && token.usdPrice !== "0" ? token.usdPrice : undefined;
      const next = { ...token, actualPrice: walletRow?.actualPrice ?? priceFromList };
      if (side === "from") setFromToken(next);
      else setToToken(next);
    }

    setSwapQuote(null);
    setQuoteDebug(null);
    setError(null);
    setSwapResult(null);
    setLastQuoteData({ fromToken: null, toToken: null, amount: "", slippage: 0.5 });

    // Clear amount when changing token via picker to avoid mismatched quote.
    setAmount("");
  };

  const amountInputRef = useRef<HTMLInputElement | null>(null);

  const ChevronDownSmall = () => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 text-muted-foreground">
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );

  const pickerTokenRow = (r: any, side: "from" | "to") => {
    const excluded =
      side === "from"
        ? String((toToken as any)?.symbol || "") === String(r.symbol || "")
        : String((fromToken as any)?.symbol || "") === String(r.symbol || "");
    const selected =
      side === "from"
        ? String((fromToken as any)?.symbol || "") === String(r.symbol || "")
        : String((toToken as any)?.symbol || "") === String(r.symbol || "");
    const isWallet = r.kind === "wallet";
    const balHuman = isWallet && Number(r.decimals) > 0
      ? Number(r.amount || 0) / Math.pow(10, Number(r.decimals))
      : 0;
    const price = Number(r.actualPrice || 0);
    const balUsd = balHuman * price;

    return (
      <button
        key={r.id}
        type="button"
        disabled={excluded}
        onClick={() => { applyPickedToken(side, r); closeTokenPicker(); }}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
          selected ? "border-border bg-muted/50" : "border-transparent hover:bg-muted/40",
          excluded && "opacity-40"
        )}
      >
        <TokenIcon src={r.logoUrl || "/file.svg"} alt={r.symbol} className="h-9 w-9 rounded-full" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold">{r.symbol}</span>
            {Array.isArray(r.tags) && r.tags[0] && r.tags[0] !== "all" && <CategoryTag tab={r.tags[0]} />}
            <ChainTag chain={r.chain} />
          </div>
          <div className="truncate text-xs text-muted-foreground">{r.name}</div>
        </div>
        <div className="shrink-0 text-right">
          {isWallet && balHuman > 0 ? (
            <>
              <div className="text-xs font-medium">{formatHumanAmount(balHuman, r.decimals ?? 8)}</div>
              {balUsd > 0 && <div className="text-[11px] text-muted-foreground">${formatNumber(balUsd)}</div>}
            </>
          ) : !isWallet && price > 0 ? (
            <>
              <div className="text-xs font-medium">${formatNumber(price)}</div>
              <div className="text-[11px] text-muted-foreground">per token</div>
            </>
          ) : null}
        </div>
        {selected && <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />}
      </button>
    );
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 sm:w-auto sm:max-w-[440px] max-h-[90dvh] overflow-y-auto rounded-2xl border bg-background p-0 shadow-lg [&>button:last-child]:hidden">
        {/* Hidden a11y title */}
        <DialogTitle className="sr-only">
          {variantTitle ?? (chainSelection === "solana" ? "Swap Tokens" : "Gasless Swap Tokens")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {variantDescription ?? `Swap tokens on ${chainSelection === "solana" ? "Solana via Jupiter" : "Aptos via Panora"}`}
        </DialogDescription>

        {/* ── Token Picker overlay ── */}
        {tokenPickerOpenFor && (
          <div className="absolute inset-0 z-50 flex flex-col rounded-2xl bg-background">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <span className="text-sm font-semibold">
                {tokenPickerOpenFor === "from" ? "You pay" : "You receive"}
              </span>
              <Button variant="ghost" size="icon" onClick={closeTokenPicker} className="h-8 w-8">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="border-b px-5 py-3">
              <div className="relative">
                <Input
                  value={tokenPickerQuery}
                  onChange={(e) => setTokenPickerQuery(e.target.value)}
                  placeholder="Search token…"
                  className="h-10 pl-9"
                  autoFocus
                />
                <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  <Search className="h-4 w-4" />
                </div>
              </div>
            </div>

            <div className="flex gap-1.5 overflow-x-auto border-b px-3 py-2">
              {([
                { id: "all", label: "All" },
                { id: "stablecoin", label: "Stablecoins" },
                { id: "lst", label: "Liquid Staking" },
                { id: "xStocks", label: "xStocks" },
                { id: "l1", label: "Layer 1" },
              ] as const).map((t) => {
                const count = pickerUniverse.counts[t.id as TokenPickerTab] ?? 0;
                if (t.id !== "all" && count <= 0) return null;
                const active = tokenPickerTab === (t.id as TokenPickerTab);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTokenPickerTab(t.id as TokenPickerTab)}
                    className={cn(
                      "shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t.label}
                    <span className={cn("ml-1 text-[10px]", active ? "opacity-70" : "opacity-40")}>{count}</span>
                  </button>
                );
              })}
            </div>

            {tokenPickerTab === "xStocks" && (
              <div className="mx-3 mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Synthetic stocks on Solana. Prices track real-time market data. Trading available 24/7.
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {pickerUniverse.rows.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No tokens found{tokenPickerQuery ? ` for "${tokenPickerQuery}"` : ""}
                </div>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    const walletRows = pickerUniverse.rows
                      .filter((r: any) => r.kind === "wallet")
                      .filter((r: any) =>
                        tokenPickerOpenFor === "from"
                          ? Number(r.amount || 0) > 0
                          : true
                      )
                      .slice(0, 40);
                    if (!walletRows.length) return null;
                    return (
                      <div>
                        <div className="px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Your wallet
                        </div>
                        {walletRows.map((r: any) => pickerTokenRow(r, tokenPickerOpenFor!))}
                      </div>
                    );
                  })()}
                  {tokenPickerOpenFor === "to" && pickerUniverse.rows.filter((r: any) => r.kind === "registry").length > 0 && (
                    <div>
                      <div className="px-1 pb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Other tokens
                      </div>
                      {pickerUniverse.rows.filter((r: any) => r.kind === "registry").slice(0, 80).map((r: any) =>
                        pickerTokenRow(r, tokenPickerOpenFor!)
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Main modal content ── */}
        <div className="min-h-0">
          {/* Header */}
          <div className="flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:pt-5">
            <div className="flex min-w-0 items-center gap-2">
              <Image src="/logo.png" alt="" width={28} height={28} className="rounded-full" />
              <span className="min-w-0 truncate text-base font-semibold tracking-tight sm:overflow-visible sm:text-clip">
                {variantTitle ??
                  (chainSelection === "solana"
                    ? (gaslessSwapEnabled ? "Gasless Swap" : "Swap Tokens")
                    : "Gasless Swap")}
              </span>
            </div>
            <div className="flex items-center gap-1 sm:justify-end">
              <div className="flex w-full overflow-hidden rounded-lg border text-xs font-medium sm:w-auto">
                {(["aptos", "solana"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      if (chainSelection === c) return;
                      didUserSelectChainRef.current = true;
                      setChainSelection(c);
                    }}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 px-2.5 py-1.5 transition-colors sm:flex-none",
                      chainSelection === c
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border",
                        chainSelection === c
                          ? "border-border bg-background"
                          : "border-transparent bg-muted/40"
                      )}
                    >
                      <ChainGlyph chain={c} className="h-3.5 w-3.5" />
                    </span>
                    {c === "aptos" ? "Aptos" : "Solana"}
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSlippage((s) => !s)}
                className={cn("h-8 w-8", showSlippage && "bg-muted text-foreground")}
              >
                <Settings className="h-4 w-4" />
              </Button>
              <Button
                onClick={onClose}
                variant="ghost"
                size="icon"
                className="h-8 w-8"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="flex flex-col gap-1 px-4 pb-4 pt-3 sm:px-5 sm:pb-5 sm:pt-4">
            {/* Slippage panel */}
            {showSlippage && (
              <div className="mb-2 rounded-xl border bg-muted/40 p-3">
                <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Slippage tolerance
                </div>
                <div className="flex gap-1.5">
                  {[0.5, 1.0, 2.0, 5.0].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setSlippage(v);
                        setSwapQuote(null);
                        setQuoteDebug(null);
                        setLastQuoteData({ fromToken: null, toToken: null, amount: "", slippage: 0.5 });
                      }}
                      className={cn(
                        "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-colors",
                        slippage === v
                          ? "border-foreground bg-foreground text-background"
                          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                      )}
                    >
                      {v}%
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* FROM card */}
            <div className="rounded-xl border bg-background p-3 sm:p-3.5 transition-colors focus-within:border-foreground/30">
              <div className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                You pay
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openTokenPicker("from")}
                  className="flex shrink-0 items-center gap-2 rounded-lg border bg-muted/50 px-2.5 py-1.5 transition-colors hover:bg-muted"
                >
                  <TokenIcon src={fromToken?.logoUrl || "/file.svg"} alt={fromToken?.symbol ?? ""} className="h-6 w-6" />
                  <span className="text-sm font-semibold">{fromToken?.symbol ?? "Select"}</span>
                  <ChevronDownSmall />
                </button>
                {(() => {
                  const chart = chartAddressForBirdeye(fromToken, chainSelection);
                  if (!chart || !fromToken) return null;
                  return (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                      title="Price chart"
                      aria-label={`${fromToken.symbol} price chart`}
                      onClick={() => setChartToken({ mint: chart.address, chain: chart.chain, symbol: fromToken.symbol, logoUrl: (fromToken as any)?.logoUrl })}
                    >
                      <LineChart className="h-4 w-4" />
                    </Button>
                  );
                })()}
                <div className="min-w-0 flex-1 text-right">
                  <input
                    ref={amountInputRef}
                    type="number"
                    placeholder="0"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setSwapResult(null);
                      setSwapQuote(null);
                      setQuoteDebug(null);
                      setLastQuoteData({ fromToken: null, toToken: null, amount: "", slippage: 0.5 });
                    }}
                    disabled={loading}
                    className="w-full bg-transparent text-xl sm:text-2xl font-semibold text-right outline-none placeholder:text-muted-foreground/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  {fromToken && amount && usdAmount > 0 && (
                    <div className="mt-0.5 text-xs text-muted-foreground">${formatNumber(usdAmount)}</div>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between border-t pt-2">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {fromBal != null ? formatHumanAmount(fromBal, fromToken?.decimals ?? 8) : "0"}{" "}
                    {fromToken?.symbol ?? ""}
                  </span>
                  {fromToken && fromBal != null && fromBal > 0 && getEffectivePrice(fromToken) > 0 && (
                    <span className="ml-1 text-muted-foreground/60">
                      ≈ ${formatNumber(fromBal * getEffectivePrice(fromToken))}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  {[25, 50, 100].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setPercent(pct)}
                      className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                    >
                      {pct === 100 ? "Max" : `${pct}%`}
                    </button>
                  ))}
                </div>
              </div>
              {fromToken && insufficient && (
                <div className={cn(
                  "mt-2 text-xs",
                  insufficient.deficitRatio <= 0.001 || autoClampedFromPrefillRef.current
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400"
                )}>
                  {autoClampedFromPrefillRef.current ? (
                    <span>Adjusted to max available. Balance: {formatHumanAmount(insufficient.have, fromToken.decimals ?? 8)} {fromToken.symbol}.</span>
                  ) : (
                    <span>Insufficient. Have {formatHumanAmount(insufficient.have, fromToken.decimals ?? 8)}, need {formatHumanAmount(insufficient.need, fromToken.decimals ?? 8)} {fromToken.symbol}.</span>
                  )}
                </div>
              )}
            </div>

            {/* Swap direction */}
            <div className="relative z-10 -my-0.5 flex justify-center">
              <button
                type="button"
                onClick={swapTokens}
                disabled={!fromToken || !toToken}
                className="flex h-8 w-8 items-center justify-center rounded-full border-2 bg-background shadow-sm text-muted-foreground transition-all hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* TO card */}
            <div className={cn(
              "rounded-xl border p-3 sm:p-3.5 transition-colors",
              swapQuote ? "border-foreground/25 bg-background" : "border-dashed bg-muted/10"
            )}>
              <div className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                You receive
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => openTokenPicker("to")}
                  className="flex shrink-0 items-center gap-2 rounded-lg border bg-muted/50 px-2.5 py-1.5 transition-colors hover:bg-muted"
                >
                  <TokenIcon src={toToken?.logoUrl || "/file.svg"} alt={toToken?.symbol ?? ""} className="h-6 w-6" />
                  <span className="text-sm font-semibold">{toToken?.symbol ?? "Select"}</span>
                  <ChevronDownSmall />
                </button>
                {(() => {
                  const chart = chartAddressForBirdeye(toToken, chainSelection);
                  if (!chart || !toToken) return null;
                  return (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                      title="Price chart"
                      aria-label={`${toToken.symbol} price chart`}
                      onClick={() => setChartToken({ mint: chart.address, chain: chart.chain, symbol: toToken.symbol, logoUrl: (toToken as any)?.logoUrl })}
                    >
                      <LineChart className="h-4 w-4" />
                    </Button>
                  );
                })()}
                <div className="min-w-0 flex-1 text-right">
                  {loading ? (
                    <div className="animate-pulse text-xl sm:text-2xl font-semibold text-muted-foreground">Quoting…</div>
                  ) : swapQuote && toToken ? (
                    <>
                      <div className="text-xl sm:text-2xl font-semibold">
                        {formatReceivedAmount(swapQuote.estimatedToAmount || swapQuote.amount || 0)}
                      </div>
                      {receiveUsdValue != null && receiveUsdValue > 0 && (
                        <div className="mt-0.5 text-xs text-muted-foreground">${formatNumber(receiveUsdValue)}</div>
                      )}
                    </>
                  ) : (
                    <div className="text-2xl font-medium text-muted-foreground/25">—</div>
                  )}
                </div>
              </div>
              {toToken && (
                <div className="mt-2 border-t pt-2">
                  <div className="text-xs text-muted-foreground">
                    Balance:{" "}
                    <span className="font-medium text-foreground">
                      {toBal != null ? formatHumanAmount(toBal, toToken.decimals ?? 8) : "0"}{" "}
                      {toToken.symbol}
                    </span>
                    {toBal != null && toBal > 0 && getEffectivePrice(toToken) > 0 && (
                      <span className="ml-1 text-muted-foreground/60">
                        ≈ ${formatNumber(toBal * getEffectivePrice(toToken))}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Quote details */}
            {swapQuote && !swapResult?.success && (
              <div className="rounded-xl border bg-muted/30 px-3.5 py-3 space-y-1.5">
                {exchangeRate != null && fromToken && toToken && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Info className="h-3 w-3" /> Rate
                    </span>
                    <span className="font-medium">1 {fromToken.symbol} ≈ {formatRate(exchangeRate)} {toToken.symbol}</span>
                  </div>
                )}
                {quoteMinReceived && toToken && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Min received</span>
                    <span className="font-medium">{quoteMinReceived} {toToken.symbol}</span>
                  </div>
                )}
                {quotePriceImpact && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Price impact</span>
                    <span className={cn("font-medium", parseFloat(quotePriceImpact) < 1 ? "text-green-600" : "text-amber-600")}>
                      -{quotePriceImpact}%
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t pt-1.5 text-xs">
                  <span className="text-muted-foreground">Slippage · Fee</span>
                  <span className="font-medium">
                    {slippage}% · {chainSelection === "solana" ? formatBpsAsPercent(jupiterPlatformFeeBpsUi) : `${panoraFee}%`}
                  </span>
                </div>
              </div>
            )}

            {/* Success card */}
            {swapResult?.success && (
              <div className="rounded-xl border border-green-200 bg-green-50 p-3.5 dark:border-green-900 dark:bg-green-950">
                <div className="mb-3 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <span className="text-sm font-semibold text-green-700 dark:text-green-400">
                    {chainSelection === "solana"
                      ? (gaslessSwapEnabled ? "Gasless swap executed!" : "Swap executed!")
                      : "Gasless swap executed!"}
                  </span>
                </div>
                {swapResult.receivedAmount && (
                  <div className="mb-3">
                    <div className="text-xs text-muted-foreground">Received</div>
                    <div className="text-xl font-bold text-foreground">
                      {formatReceivedAmount(swapResult.receivedAmount)} {swapResult.receivedSymbol}
                    </div>
                    {receiveUsdValue != null && receiveUsdValue > 0 && (
                      <div className="text-xs text-muted-foreground">${formatNumber(receiveUsdValue)}</div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Gas fee</span>
                    <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                      {chainSelection === "solana" ? (gaslessSwapEnabled ? "Paid by Gas Station" : "Paid by wallet") : "Paid by Gas Station"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Tx hash</span>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {formatHash(swapResult.hash || "")}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(swapResult.hash || "")}
                        className="flex h-6 w-6 items-center justify-center rounded border bg-background text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => openExplorer(swapResult.hash || "")}
                        className="flex h-6 w-6 items-center justify-center rounded border bg-background text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Error from swap result */}
            {swapResult && !swapResult.success && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-medium text-amber-700 dark:text-amber-300">Swap cancelled</span>
                </div>
                {swapResult.error && (
                  <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">User rejected swap</div>
                )}
              </div>
            )}

            {/* API error */}
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
              </div>
            )}

            {/* Action button */}
            <button
              type="button"
              onClick={getButtonConfig().action ?? undefined}
              disabled={loading || getButtonConfig().disabled}
              className={cn(
                "mt-1 flex w-full items-center justify-center gap-2 rounded-xl py-3 sm:py-3.5 text-sm font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed",
                swapResult?.success
                  ? "bg-green-600 text-white hover:opacity-90"
                  : "bg-foreground text-background hover:opacity-85"
              )}
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading
                ? getButtonConfig().text === "Get Quote" ? "Getting Quote…" : "Executing…"
                : getButtonConfig().text}
            </button>

            {/* Refresh quote */}
            {swapQuote && !loading && !hasDataChanged() && !swapResult?.success && (
              <button
                type="button"
                onClick={getQuote}
                className="flex w-full items-center justify-center rounded-xl border py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50"
              >
                Refresh Quote
              </button>
            )}

            {/* Auto-update hint */}
            {chainSelection === "aptos" && !loading && !swapQuote && fromToken && toToken && amount && parseFloat(amount) > 0 && (
              <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Quote will update automatically…</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="pb-3 text-center text-[11px] text-muted-foreground">
            {chainSelection === "solana"
              ? (gaslessSwapEnabled
                ? `Gasless · no SOL required for gas · ${formatBpsAsPercent(jupiterPlatformFeeBpsUi)} swap fee`
                : `${formatBpsAsPercent(jupiterPlatformFeeBpsUi)} swap fee applies`)
              : `Gasless · no APT required for gas · ${panoraFee}% swap fee`}
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={chartToken != null} onOpenChange={(open) => !open && setChartToken(null)}>
      <DialogContent className="z-[120] sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              {chartToken?.logoUrl ? (
                <TokenIcon src={chartToken.logoUrl} alt={chartToken.symbol} className="h-6 w-6 rounded-full" />
              ) : null}
              <span>{chartToken ? `${chartToken.symbol} price chart` : "Price chart"}</span>
            </span>
          </DialogTitle>
          <DialogDescription>
            Historical price data (if available).
          </DialogDescription>
        </DialogHeader>
        {chartToken ? <SwapTokenChart mint={chartToken.mint} chain={chartToken.chain} symbol={chartToken.symbol} /> : null}
      </DialogContent>
    </Dialog>
    </>
  );
}
