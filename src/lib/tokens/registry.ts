export type TokenChain = "aptos" | "solana";

export type TokenTag = "stablecoin" | "lst" | "xStocks" | "l1";

export type TokenRegistryItem = {
  /** Stable ID (do not change once shipped). */
  id: string;
  chain: TokenChain;
  symbol: string;
  name: string;
  decimals: number;
  /** Full URL or absolute path under /public. */
  logoUrl: string;
  /** Categories/tags used by token picker tabs. */
  tags: TokenTag[];
  addresses: {
    /** Aptos fungible asset address. */
    faAddress?: string;
    /** Solana mint address. */
    mint?: string;
  };
};

/**
 * Curated token registry for swap token picker.
 *
 * Source of truth today:
 * - Aptos tokens: Panora token list (`src/lib/data/tokenList.json`) selected subset.
 * - Solana tokens: current allowlist from `src/components/ui/swap-modal.tsx` (SOLANA_SWAP_TOKENS).
 *
 * Note: `tags` are curated and intentionally minimal; expand as we add new tabs/categories.
 */
export const TOKEN_REGISTRY: TokenRegistryItem[] = [
  // --------------------
  // Aptos (required / default)
  // --------------------
  {
    id: "aptos:0xa",
    chain: "aptos",
    symbol: "APT",
    name: "Aptos Coin",
    decimals: 8,
    logoUrl: "https://assets.panora.exchange/tokens/aptos/apt.svg",
    tags: ["l1"],
    addresses: { faAddress: "0xa" },
  },
  {
    id: "aptos:0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b",
    chain: "aptos",
    symbol: "USDt",
    name: "Tether USD",
    decimals: 6,
    logoUrl: "https://assets.panora.exchange/tokens/aptos/usdt.svg",
    tags: ["stablecoin"],
    addresses: { faAddress: "0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b" },
  },
  {
    id: "aptos:0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b",
    chain: "aptos",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoUrl: "https://assets.panora.exchange/tokens/aptos/usdc.svg",
    tags: ["stablecoin"],
    addresses: { faAddress: "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b" },
  },
  {
    id: "aptos:0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2",
    chain: "aptos",
    symbol: "USD1",
    name: "World Liberty USD",
    decimals: 6,
    logoUrl: "https://assets.panora.exchange/tokens/aptos/usd1.svg",
    tags: ["stablecoin"],
    addresses: { faAddress: "0x05fabd1b12e39967a3c24e91b7b8f67719a6dacee74f3c8b9fb7d93e855437d2" },
  },
  {
    id: "aptos:0x68844a0d7f2587e726ad0579f3d640865bb4162c08a4589eeda3f9689ec52a3d",
    chain: "aptos",
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    decimals: 8,
    logoUrl: "https://assets.panora.exchange/tokens/aptos/wbtc.svg",
    tags: ["l1"],
    addresses: { faAddress: "0x68844a0d7f2587e726ad0579f3d640865bb4162c08a4589eeda3f9689ec52a3d" },
  },

  // --------------------
  // Solana (allowlist from current swap modal)
  // --------------------
  {
    id: "solana:So11111111111111111111111111111111111111112",
    chain: "solana",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    logoUrl: "/token_ico/sol.png",
    tags: ["l1"],
    addresses: { mint: "So11111111111111111111111111111111111111112" },
  },
  {
    id: "solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    chain: "solana",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logoUrl:
      "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
    tags: ["stablecoin"],
    addresses: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  },
  {
    id: "solana:JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    chain: "solana",
    symbol: "JUP",
    name: "Jupiter",
    decimals: 6,
    logoUrl: "https://static.jup.ag/jup/icon.png",
    tags: [],
    addresses: { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  },
  {
    id: "solana:jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL",
    chain: "solana",
    symbol: "JTO",
    name: "Jito",
    decimals: 9,
    logoUrl: "https://metadata.jito.network/token/jto/image",
    tags: [],
    addresses: { mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL" },
  },
  {
    id: "solana:4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    chain: "solana",
    symbol: "RAY",
    name: "Raydium",
    decimals: 6,
    logoUrl:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png",
    tags: [],
    addresses: { mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  },
  {
    id: "solana:HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
    chain: "solana",
    symbol: "PYTH",
    name: "Pyth Network",
    decimals: 6,
    logoUrl: "https://pyth.network/token.svg",
    tags: [],
    addresses: { mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  },
  {
    id: "solana:KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS",
    chain: "solana",
    symbol: "KMNO",
    name: "Kamino",
    decimals: 6,
    logoUrl: "https://cdn.kamino.finance/kamino.svg",
    tags: [],
    addresses: { mint: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS" },
  },
  {
    id: "solana:7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs",
    chain: "solana",
    symbol: "WETH",
    name: "Ether (Portal)",
    decimals: 8,
    logoUrl:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs/logo.png",
    tags: ["l1"],
    addresses: { mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs" },
  },
  {
    id: "solana:cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij",
    chain: "solana",
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    decimals: 8,
    logoUrl: "https://ipfs.io/ipfs/QmZ7L8yd5j36oXXydUiYFiFsRHbi3EdgC4RuFwvM7dcqge",
    tags: ["l1"],
    addresses: { mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij" },
  },

  // xStocks (Solana)
  {
    id: "solana:XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    chain: "solana",
    symbol: "CRCLx",
    name: "Circle xStock",
    decimals: 8,
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/CRCLx.png",
    tags: ["xStocks"],
    addresses: { mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1" },
  },
  {
    id: "solana:XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    chain: "solana",
    symbol: "TSLAx",
    name: "Tesla xStock",
    decimals: 8,
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/TSLAx.png",
    tags: ["xStocks"],
    addresses: { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB" },
  },
  {
    id: "solana:Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh",
    chain: "solana",
    symbol: "NVDAx",
    name: "NVIDIA xStock",
    decimals: 8,
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/NVDAx.png",
    tags: ["xStocks"],
    addresses: { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh" },
  },
  {
    id: "solana:XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W",
    chain: "solana",
    symbol: "SPYx",
    name: "SP500 xStock",
    decimals: 8,
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/SPYx.png",
    tags: ["xStocks"],
    addresses: { mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W" },
  },
  {
    id: "solana:XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN",
    chain: "solana",
    symbol: "GOOGLx",
    name: "Alphabet xStock",
    decimals: 8,
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/GOOGLx.png",
    tags: ["xStocks"],
    addresses: { mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN" },
  },
  {
    id: "solana:XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    chain: "solana",
    symbol: "AAPLx",
    name: "Apple xStock",
    decimals: 8,
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/AAPLx.png",
    tags: ["xStocks"],
    addresses: { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp" },
  },
  {
    id: "solana:Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu",
    chain: "solana",
    symbol: "METAx",
    name: "Meta xStock",
    decimals: 8,
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/METAx.png",
    tags: ["xStocks"],
    addresses: { mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu" },
  },
  {
    id: "solana:XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2",
    chain: "solana",
    symbol: "MCDx",
    name: "McDonald's xStock",
    decimals: 8,
    logoUrl: "https://xstocks-metadata.backed.fi/logos/tokens/MCDx.png",
    tags: ["xStocks"],
    addresses: { mint: "XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2" },
  },
  {
    id: "solana:A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS",
    chain: "solana",
    symbol: "ZEC",
    name: "Zcash",
    decimals: 8,
    logoUrl: "https://arweave.net/QSYqnmB7NYlB7n1R6rz935Y07dlRK0tIuKe2mof5Sho",
    tags: [],
    addresses: { mint: "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS" },
  },
  {
    id: "solana:98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g",
    chain: "solana",
    symbol: "HYPE",
    name: "HYPE",
    decimals: 9,
    logoUrl: "https://arweave.net/QBRdRop8wI4PpScSRTKyibv-fQuYBua-WOvC7tuJyJo",
    tags: [],
    addresses: { mint: "98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g" },
  },
  {
    id: "solana:GbbesPbaYh5uiAZSYNXTc7w9jty1rpg3P9L4JeN4LkKc",
    chain: "solana",
    symbol: "TRX",
    name: "TRON",
    decimals: 6,
    logoUrl: "https://arweave.net/aO9owy2SUH92KGJ2CH3BFowep6XFAoYjjpRyDKObkww",
    tags: [],
    addresses: { mint: "GbbesPbaYh5uiAZSYNXTc7w9jty1rpg3P9L4JeN4LkKc" },
  },
  {
    id: "solana:pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
    chain: "solana",
    symbol: "PUMP",
    name: "Pump",
    decimals: 6,
    logoUrl: "https://ipfs.io/ipfs/bafkreibyb3hcn7gglvdqpmklfev3fut3eqv3kje54l3to3xzxxbgpt5wjm",
    tags: [],
    addresses: { mint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn" },
  },
  {
    id: "solana:SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3",
    chain: "solana",
    symbol: "SKR",
    name: "Seeker",
    decimals: 6,
    logoUrl: "https://gateway.irys.xyz/uP1dFvCofZQT26m3SKOCttXrir3ORBR1B8wPhP6tv7M?ext=png",
    tags: [],
    addresses: { mint: "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3" },
  },
  {
    id: "solana:AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P",
    chain: "solana",
    symbol: "XAUt0",
    name: "Tether Gold",
    decimals: 6,
    logoUrl: "https://ipfs.io/ipfs/bafkreibth2yh4jlehmf5nmfgy763z4yvwxlz7zmuohmhp53un6wrho5t2q",
    tags: [],
    addresses: { mint: "AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P" },
  },
];

