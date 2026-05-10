# Tramplin Wallet Data

This note describes how to fetch Tramplin staking and rewards data for a specific Solana wallet.

## Constants

- Tramplin validator vote account: `TRAMp1Z9EXyWQQNwNjjoNvVksMUHKioVU7ky61yNsEq`
- Tramplin draw program: `3NJyzGWjSHP4hZvsqakodi7jAtbufwd52vn1ek6EzQ35`
- Production API base: `https://api.tramplin.io/api`
- Snapshot base: `https://snapshots.tramplin.io`

## Wallet Stats

Fetch aggregate public stats:

```bash
curl "https://api.tramplin.io/api/readPublicStats?walletAddress=<WALLET>"
```

Response fields observed:

- `totalStakeAmount`: displayed SOL stake tracked by Tramplin.
- `totalPoints`: Tramplin points.
- `effectiveStake`: stake after multiplier/points/referral adjustments, in SOL.
- `effectiveStakeLamports`: effective stake in lamports.
- `apr`: Tramplin API APR for the wallet.
- `totalWinLamports`: total won rewards, claimed plus unclaimed.
- `totalWinSol`: total won rewards in SOL.
- `multiplier`: current wallet multiplier.
- `isAttendingRegularDraw`, `isAttendingBigDraw`: current eligibility flags.

Example for `EP9fKzBpQzyZC2GYjjAF9tKEeUwi7dqNqMStmxdYu4h2`:

```json
{
  "totalStakeAmount": 1,
  "totalPoints": 560,
  "effectiveStake": 2.932184,
  "effectiveStakeLamports": 2932183566,
  "apr": 77.76,
  "totalWinLamports": 222302941,
  "totalWinSol": 0.222303,
  "multiplier": 2.9321835661585918,
  "isAttendingRegularDraw": true,
  "isAttendingBigDraw": true
}
```

## Wins And Claimable Rewards

Fetch all known public wins for a wallet:

```bash
curl "https://api.tramplin.io/api/indexPublicWins?walletAddress=<WALLET>&limit=250"
```

Fetch only unclaimed wins:

```bash
curl "https://api.tramplin.io/api/indexPublicWins?walletAddress=<WALLET>&isClaimed=false&limit=250"
```

Useful `Win` fields:

- `prizeLamports`, `prizeSol`: reward amount.
- `drawType`: `regular`, `big`, or `epoch`.
- `epochOrSlot`, `epochNumber`: draw period identifiers.
- `revealedAt`, `revealedAtSlot`: reveal time.
- `isClaimed`, `claimedAt`, `claimPda`: claim status.
- `stakeId`, `winnerId`, `stake`, `stakeForView`, `stakeForViewSol`: winner/share data.
- `merkleProofs`, `drawPda`: required later to build claim instructions.
- `participants`, `poolShares`, `points`, `snapshotUrl`: draw context when exposed by API.

For wallet-level reward totals:

```text
total_wins_lamports = sum(all wins prizeLamports)
unclaimed_lamports = sum(unclaimed wins prizeLamports)
claimed_lamports = total_wins_lamports - unclaimed_lamports
```

The `readPublicStats.totalWinLamports` value should match `sum(indexPublicWins[].prizeLamports)`.

## On-Chain Native Stake

Tramplin uses native Solana stake accounts delegated to its validator. To detect a wallet position without relying on the Tramplin backend:

1. Query the Solana stake program with a memcmp filter on `meta.authorized.staker`.
2. Decode stake accounts.
3. Keep accounts whose `delegation.voter` is the Tramplin vote account.

The staker authority offset used by the Tramplin app is `12`:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getProgramAccounts",
  "params": [
    "Stake11111111111111111111111111111111111111",
    {
      "encoding": "jsonParsed",
      "filters": [
        { "dataSize": 200 },
        {
          "memcmp": {
            "offset": 12,
            "bytes": "<WALLET>"
          }
        }
      ]
    }
  ]
}
```

Use these parsed fields:

- `account.data.parsed.info.stake.delegation.stake`: delegated lamports.
- `account.data.parsed.info.stake.delegation.voter`: validator vote account.
- `account.data.parsed.info.stake.delegation.activationEpoch`: activation epoch.
- `account.data.parsed.info.stake.delegation.deactivationEpoch`: `18446744073709551615` means not deactivating.
- `account.lamports`: stake account lamports, including rent reserve.

Example for `EP9f...`:

- Stake account: `FZQBSD6tUtHQCAF57NizfKhyAyKM4n39jD6gaSXKcTQJ`
- Delegated stake: `1 SOL`
- Voter: `TRAMp1Z9EXyWQQNwNjjoNvVksMUHKioVU7ky61yNsEq`
- Activation epoch: `908`
- Status: active

## Wallet Realized APR

For a wallet, a rough realized APR can be computed from its own wins:

```text
wallet_realized_apr = wallet_rewards_sol / wallet_staked_sol / (period_days / 365)
```

For the example wallet:

- Start: activation epoch `908`, approximately `2026-01-09 02:22:06 UTC`
- End: current epoch `964` start, approximately `2026-04-29 13:36:17 UTC`
- Period: `110.47` days
- Stake: `1 SOL`
- Total wins: `0.222302941 SOL`
- Claimed-only wins: `0.028142334 SOL`

Results:

```text
total-wins realized APR ~= 73.45%
claimed-only realized APR ~= 9.30%
```

Tramplin API reports `apr: 77.76` for the same wallet, so their production calculation likely uses a slightly different end timestamp or period basis.

## Snapshot Context

Some wins include a public `snapshotUrl`, for example:

```text
https://snapshots.tramplin.io/960-regular-TRAMp1Z9EXyWQQNwNjjoNvVksMUHKioVU7ky61yNsEq.json
```

Snapshot fields observed:

- `config.vote_account`
- `context.created_at`, `context.slot`, `context.epoch`
- `raw`: raw stake account data included in the snapshot.
- `stakes`: wallet or stake identifiers to native stake amounts.
- `points`: point balances used in the draw.
- `effective_stakes`: effective stake after modifiers.
- `shares`: draw shares.
- `merkle_tree`: root and tree nodes.

Use snapshots for historical draw context and project-level APR. The denominator should be eligible participant stake from snapshots, not the full validator stake.
