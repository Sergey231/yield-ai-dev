# Orca integration (Yield AI)

Orca is a Solana-native DEX integration. Current scope supports Whirlpool
concentrated-liquidity position display plus wallet-signed claim and close
actions.

## Current user positions route

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/protocols/orca/userPositions?address=<solana>&debug=1` | Finds Orca Whirlpool position NFTs in a wallet and enriches them with pool/token/price data. |
| `POST` | `/api/protocols/orca/claimFees` | Builds an unsigned Orca Whirlpool harvest transaction for the connected wallet to sign. |
| `POST` | `/api/protocols/orca/closePosition` | Builds an unsigned Orca Whirlpool full close transaction for the connected wallet to sign. |

The route scans wallet token accounts for 1-of-1 NFT mints, derives each Orca
position PDA with the Whirlpool program, fetches the Whirlpool account, then
returns:

- pool / position addresses,
- token A/B metadata,
- tick lower / upper / current,
- current and range prices,
- in-range status,
- estimated token A/B liquidity amounts,
- stored unclaimed fees,
- USD totals via Jupiter price data.

Limitations:

- Position bundles are not decoded yet.
- Fees/rewards are enriched with the SDK `harvestPositionInstructions(...)`
  quote path. The stored position counters can be stale until
  `updateFeesAndRewards`, so the UI uses the live harvest quote for
  `unclaimedUsd`.

## UI files

- `src/components/protocols/orca/PositionsList.tsx` - sidebar/portfolio card.
- `src/components/protocols/manage-positions/protocols/OrcaPositions.tsx` - detail panel.
- `src/lib/query/hooks/protocols/orca/useOrcaPositions.ts` - React Query hook.
- `src/components/protocols/orca/mapOrcaToProtocolPositions.ts` - card mapper/totals.

Program id: `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`.

Orca is wired into `Sidebar`, `PortfolioPage`, `MobileTabs`,
`ManagePositions`, `queryKeys`, the public wallet protocols route, and
`protocolsList.json`.

## Claim / close implementation

Official Orca TypeScript SDK docs expose two relevant helper paths:

- `harvestPositionInstructions(rpc, positionMintAddress, authority?)` builds the
  instructions to collect accumulated fees and rewards while leaving liquidity
  open: https://dev.orca.so/ts/functions/_orca-so_whirlpools.harvestPositionInstructions.html
- `closePositionInstructions(rpc, positionMintAddress, slippageToleranceBps?,
  authority?)` builds a full close flow that withdraws liquidity and includes
  fees/rewards quote objects: https://dev.orca.so/ts/types/_orca-so_whirlpools.ClosePositionInstructions.html

The app uses those SDK helpers in
`src/app/api/protocols/orca/_lib/whirlpoolActions.ts`. The routes accept
`owner`, `poolId`, and either `positionPda` or `nftMint`, verify that the wallet
owns the position NFT, build unsigned transactions server-side, then return
base64 payloads for the connected wallet to sign and submit via
`/api/solana/sendRaw`.

The UI buttons live in
`src/components/protocols/manage-positions/protocols/OrcaPositions.tsx` and
invalidate `queryKeys.protocols.orca.userPositions(address)` after a successful
submission.

Close uses Orca's `closePositionInstructions(...)`, so it withdraws full
liquidity, includes accrued fees/rewards, and closes the Whirlpool position NFT.
