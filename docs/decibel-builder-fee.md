# Decibel builder fee — how it works and integration plan for AI agent (delta-neutral)

This doc explains the **builder fee** mechanism on Decibel, how Yield AI uses it today (standalone Decibel flow), what's missing for the **AI agent delta-neutral** flow, and the plan to close that gap.

> Companion to [decibel-builder-integration.md](decibel-builder-integration.md) (Decibel's official integration spec). This doc is the Yield-AI-specific layer.

---

## 1. What is a builder fee

Decibel takes a small protocol fee on every order. On top of that, the **builder** (the app that brought the user — us) can attach an additional fee, capped by the user. The flow:

| Step | Who signs | Move entry function | Notes |
|---|---|---|---|
| 1. Onboard | Decibel API only (no signer) | `referrals/redeem` | creates user's subaccount |
| 2. **Approve builder fee (one-time)** | **owner wallet** | `dex_accounts_entry::approve_max_builder_fee_for_subaccount(subaccount, builder_addr, max_fee_bps)` | user grants us permission to take up to N bps |
| 3. Trade | API wallet (executor) | `dex_accounts_entry::place_order_to_subaccount(...)` with `builder_addr`, `builder_fee` | per order; `builder_fee ≤ max_fee_bps` from step 2 |
| 4. Withdraw | builder's owner wallet | `dex_accounts_entry::withdraw_from_subaccount(...)` | builder cashes out from its own subaccount |

Key facts:

- **`max_fee_bps`** is u64 in basis points: `10` = 0.1%, `100` = 1%. Approval is a one-time grant per `(subaccount, builder_addr)` pair. Re-approval is needed only to change the cap or revoke (set to 0).
- Per-order `builder_fee` ≤ `max_fee_bps`. We can charge less than approved.
- Builder fee accumulates in **builder's own subaccount** (USDC balance). Withdrawal is a separate owner-signed action by the builder.
- Approval is **per subaccount**. If the user has multiple subaccounts, approving one does **not** cover the others.

### Relationship to `@decibeltrade/sdk` v0.6.0 release (April 2026)

Decibel released v0.6.0 with a fix:

> "We have updated the builderFee field to charge fees in basis points... If you previously implemented a workaround to scale fees manually, you'll want to remove that logic before updating to v.0.6.0 to avoid fees being 100x higher than intended."

What happened: previous SDK versions internally scaled `builderFee` by 1/100 before submission. If a developer passed `10` meaning "10 bps", on-chain it ended up as 0.1 bps. People who noticed compensated by passing `1000` → 10 bps on-chain. v0.6.0 removed the silent scaling: now `10` → 10 bps directly. Anyone who pre-compensated must un-compensate before upgrading.

**This change does not affect Yield AI.** We do not use `@decibeltrade/sdk` to submit orders. We construct Move entry-function payloads directly:

- [src/lib/protocols/decibel/approveBuilderFee.ts](../src/lib/protocols/decibel/approveBuilderFee.ts) — approve max fee payload
- [src/lib/protocols/decibel/closePosition.ts](../src/lib/protocols/decibel/closePosition.ts) — `buildOpenMarketOrderPayload`, `buildCloseAtMarketPayload` accept `builderAddr` + `builderFeeBps` and pass them as u64 directly to `place_order_to_subaccount`

On-chain Move expects `u64` bps as-is, so we always passed the correct value (`DECIBEL_BUILDER_FEE_BPS` env, default `10`). The SDK scaling bug was inside `@decibeltrade/sdk`'s JS layer only.

---

## 2. How Yield AI uses builder fee today

### Standalone Decibel flow (working, owner-signed)

User opens a position from the Decibel page (not via AI agent). Code paths:

- [src/components/ui/decibel-cta-block.tsx](../src/components/ui/decibel-cta-block.tsx) — homepage CTA: "Enable trading via Yield AI" button calls `handleApproveBuilderFee`. It:
  1. Fetches `/api/protocols/decibel/builder-config` → `{ builderAddress, builderFeeBps }`.
  2. Builds `approve_max_builder_fee_for_subaccount` payload via `buildApproveBuilderFeePayload`.
  3. Submits via `signAndSubmitTransaction` (**owner wallet signs**).
- [src/components/protocols/manage-positions/protocols/DecibelPositions.tsx](../src/components/protocols/manage-positions/protocols/DecibelPositions.tsx) — same approve flow inside the manage-positions modal. Then `place_order` payloads pass `builderConfig.builderAddress` and `builderConfig.builderFeeBps`.
- [src/components/decibel/decibel-open-position-modal.tsx](../src/components/decibel/decibel-open-position-modal.tsx) — open-position modal, also passes `builderAddr` + `builderFeeBps` on every place/close.

The approval status is checked via:
- `GET /api/protocols/decibel/approved-max-fee?subaccount=...&builder=...` ([route](../src/app/api/protocols/decibel/approved-max-fee/route.ts)) — calls Move view `builder_code_registry::get_approved_max_fee` and returns `Option<u64>` parsed.

Configuration lives in env:
- `DECIBEL_BUILDER_ADDRESS` — our subaccount that collects fees.
- `DECIBEL_BUILDER_FEE_BPS` — current per-order fee. Default 10 (0.1%).

### AI agent delta-neutral flow (BROKEN — no builder fee collected)

Code paths:

- [src/app/api/protocols/decibel/executor-open-delta-neutral/route.ts](../src/app/api/protocols/decibel/executor-open-delta-neutral/route.ts) — calls `buildOpenMarketOrderPayload` **without** `builderAddr` / `builderFeeBps`. Order goes through, no fee collected.
- [src/app/api/protocols/decibel/executor-close-delta-neutral/route.ts](../src/app/api/protocols/decibel/executor-close-delta-neutral/route.ts) — same: `buildCloseAtMarketPayload` invoked without builder params.
- The DN onboarding card ([DecibelOnboardingCard.tsx](../src/components/protocols/yield-ai/DecibelOnboardingCard.tsx)) does **not** check `approved-max-fee` — it asks for delegation only.

**Net effect today:** every DN open/close on Decibel via executor goes through with `builder_fee = null`, so we earn nothing from AI agent traffic. Even if user has already approved (e.g. they used the standalone Decibel page first), we don't take advantage because we don't include the builder args in the executor's place_order.

---

## 3. Can the executor sign the approve transaction?

Almost certainly **no** — it's an owner-only action.

`approve_max_builder_fee_for_subaccount(owner_signer, subaccount, builder, max_fee)` grants new permission to a builder. This is a security-relevant state change, analogous to withdrawals. Decibel's docs explicitly carve out:

> Delegation Model: Primary Wallet signs a transaction to delegate trading permissions to an API Wallet... API Wallet cannot withdraw funds; withdrawals always require the Primary Wallet's signature.

By the same logic, approving a fee grant is owner-only. The executor's delegation (`delegate_trading_permission`) covers `place_order` / `close`, not permission management.

**Action item:** confirm with Decibel team. If they explicitly enabled approve-via-delegate, we save a user signature. If not (likely), plan around owner-signed approval.

---

## 4. Pre-existing approvals in the wild

Some users (e.g. `0x56ff2fc971deecd286314fe99b8ffd6a5e72e62eacdc46ae9b234c5282985f97`) **already approved** because they used the standalone Decibel CTA before the AI agent flow existed. We can detect this state via the existing `approved-max-fee` view and skip the approve step for them.

Approval is checked **per subaccount**, so if a user only approved their primary subaccount and uses a different one for DN, they need to approve again. Our DN flow currently uses the primary by default, so coverage is high but not 100%.

---

## 5. Implementation plan for AI agent delta-neutral

Two independent pieces. Doing them in this order is safe (no broken intermediate state).

### Phase 1 — collect fee on AI agent trades (server-only, no UX change)

**Goal:** start collecting builder fees on DN open/close for users who already approved (e.g. via standalone Decibel page).

**Changes:**

1. In [executor-open-delta-neutral/route.ts](../src/app/api/protocols/decibel/executor-open-delta-neutral/route.ts), before building the open payload:
   - Read `DECIBEL_BUILDER_ADDRESS` and `DECIBEL_BUILDER_FEE_BPS` from env.
   - Query `get_approved_max_fee(subaccount, builder)` view. If approval exists and `≥ feeBps`, set `builderAddr` + `builderFeeBps` in `buildOpenMarketOrderPayload`. Otherwise, pass them as null (current behaviour) — order proceeds without fee.
   - Log a warning when fee is skipped due to missing approval, so we can measure leakage.
2. Mirror the same logic in [executor-close-delta-neutral/route.ts](../src/app/api/protocols/decibel/executor-close-delta-neutral/route.ts) for `buildCloseAtMarketPayload`.

**Risk:** none. If approval is missing, we degrade gracefully to today's behaviour. If approval exists, we suddenly start collecting fee — that's the goal.

**Expected impact:** for users who already enabled (CTA-block users), every AI agent DN cycle starts paying the 10 bps fee.

### Phase 2 — make approve part of DN onboarding (owner UX)

**Goal:** for users who never used the standalone Decibel page, expose the approve step inside the DN onboarding card so the AI agent can collect fees from the first trade.

**Changes:**

1. Extend [useDecibelOnboardingStatus.ts](../src/lib/query/hooks/protocols/decibel/useDecibelOnboardingStatus.ts):
   - Add a fourth step `approve_builder_fee` between `delegation` and `balance_decibel`.
   - Status check: `GET /api/protocols/decibel/approved-max-fee?subaccount={primary}&builder={ourBuilder}` — completed when `approvedMaxFeeBps ≥ DECIBEL_BUILDER_FEE_BPS`.
2. In [DecibelOnboardingCard.tsx](../src/components/protocols/yield-ai/DecibelOnboardingCard.tsx):
   - Add an "Approve builder fee" button when the step is `required`. Reuse the existing `buildApproveBuilderFeePayload` + `signAndSubmitTransaction` pattern from [decibel-cta-block.tsx:141](../src/components/ui/decibel-cta-block.tsx:141). This is owner-signed.
   - On success, refetch `approved-max-fee` and the step flips to `completed`.
3. Hook into the "Open delta-neutral" submit guard in [YieldAIPositions.tsx](../src/components/protocols/manage-positions/protocols/YieldAIPositions.tsx) — refuse submission with a clear toast when approval is missing, instead of silently skipping the fee.

**UX copy hint** (one line): "One-time signature: lets the AI agent earn a 0.1% builder fee on Decibel trades. You can revoke any time on Decibel."

**Risk:** UX friction (extra signature). Mitigation:
- Skip the step entirely for users with existing approval ≥ our cap (already handled by step 1's status check).
- Combine with the delegation step visually so the user sees a single "enable trading" block with two sub-actions.

### Phase 3 (optional) — same for non-primary subaccounts

If we ever support DN on a non-primary subaccount (today we always pick primary in onboarding), repeat the approve check for whichever subaccount the user picks. The hook already takes a subaccount parameter, so it scales without code structure changes.

---

## 6. Open questions / TODO

- [ ] **Confirm with Decibel team:** can `approve_max_builder_fee_for_subaccount` be signed by the delegated executor instead of the owner? If yes, fold approve into the executor flow (no user signature). If no, proceed with Phase 2 as described.
- [ ] **Confirm SDK v0.6.0 is irrelevant:** the on-chain `place_order_to_subaccount` `builder_fee` argument is u64 bps without internal scaling. We pass `10` for 10 bps. (Sanity-check by reading from-chain: after a trade, inspect the recorded fee.)
- [ ] **Decide on canonical fee:** today `DECIBEL_BUILDER_FEE_BPS` defaults to 10 (0.1%). Validate this is competitive with other Decibel builders before AI agent ships at scale.
- [ ] **Approval leakage telemetry:** during Phase 1, log how many DN opens fall back to "no fee" so we know how much we lose to missing approvals before Phase 2 ships.
- [ ] **Withdraw flow for our builder subaccount:** a separate operational task (not user-facing). Set a recurring withdraw from our builder subaccount to ops wallet so accumulated USDC doesn't sit on Decibel.
