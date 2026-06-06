# Decibel Referral Dashboard

## Scope

Yield AI can expose Decibel referral analytics without making one request per referred wallet.
The Decibel affiliate earnings endpoint already returns per-user lifetime volume, activity state,
referral level, and AMPS earned for the affiliate.

The server-side aggregate route is:

```text
GET /api/protocols/decibel/referralDashboard?address={aptos_owner_address}
```

`address` is required. The route normalizes the Aptos address and keeps `DECIBEL_API_KEY`
server-side.

## Upstream requests

One client request runs four Decibel requests in parallel:

```text
GET /api/v1/referrals/stats/{account}
GET /api/v1/affiliates/codes/{account}
GET /api/v1/affiliates/earnings/{account}?limit=1000&offset=0
GET /api/v1/points_leaderboard?search_term={account}
```

Do not call `account_overviews` once per referred wallet. The earnings response already
contains each user's `total_volume`.

The aggregate response uses `Cache-Control: private, max-age=60`. It returns:

- `summary`: referral counts, threshold state, L1/L2 active counts and volumes, leaderboard
  AMPS, and affiliate AMPS.
- `codes`: referral codes with usage and active state.
- `top_users`: the top 20 L1/L2 users by lifetime volume. Wallet addresses are masked.
- `users`: returned and total user counts plus a truncation flag.
- `l2_by_referrer`: L2 totals grouped by the masked L1 wallet that invited them.
- `warnings`: partial upstream failures. Available data is still returned when possible.

The upstream earnings query is intentionally capped at 1000 users. The response exposes
`users.truncated`; add server-side pagination if production accounts exceed that cap.

The public route intentionally does not return raw referral wallet addresses or a full user
list. Add a separate authenticated admin route if operations needs that drill-down later.

## API caveats

Do not use `referrals/stats.is_affiliate` as the only feature gate. On June 3, 2026,
Decibel returned `is_affiliate: false` from referral stats for an account while
`affiliates/earnings/{account}` still returned a complete L1 breakdown.

Treat leaderboard `referral_amps` as the canonical referral points value shown beside a
wallet's total AMPS. Keep affiliate earnings AMPS as a separate breakdown because Decibel
may return values that do not add up to the leaderboard value.

The existing lightweight route remains available:

```text
GET /api/protocols/decibel/referrerStats?address={aptos_owner_address}
```

It now preserves Decibel's boolean `is_affiliate` and `volume_threshold_met` fields.

## Manage Positions integration

Referral analytics should be discoverable without competing with positions, PnL, or trade
actions.

Implemented placement:

1. Keep the current AMPS row in `DecibelPositions`.
2. Add a small secondary `Referral details` text button beside the AMPS value.
3. Open a `Dialog` titled `Decibel referral activity`.
4. Fetch `/api/protocols/decibel/referralDashboard` only when the dialog opens.
5. Show three compact summary cards first: referrals, active users, lifetime volume.
6. Put L1/L2 detail, referral codes, and top wallets inside the dialog below the summary.

Avoid a new always-visible dashboard block in Manage Positions. Referral analytics is useful
context, but it is secondary to account equity and open positions.

For the client query:

- Use `useDecibelReferralDashboard` with `enabled: dialogOpen && Boolean(address)`.
- Set `staleTime` to 5 minutes and `gcTime` to 10 minutes.
- Disable refetch on window focus for this query.
- Fetch once per open dialog session and reuse cached data when the dialog is reopened.
- Render `users.truncated` as a small note if it is true.

An admin page can reuse the aggregate route later. Add an authenticated admin route before
exposing raw wallet addresses or full referral lists.

## Manual mainnet findings

Read-only mainnet checks on June 3, 2026 validated the response shape:

| Wallet | L1 users | L2 users | Active L1 | Active L2 | Lifetime volume |
| --- | ---: | ---: | ---: | ---: | ---: |
| `0x28e7...331f6` | 100 | 0 | 29 | 0 | `$1,784,267.26` |
| `0x56ff...5f97` | 81 | 111 | 18 | 34 | `$3,629,791.68` |

The first wallet is one of the second wallet's L1 referrals and accounts for 100 of its
111 L2 referrals.
