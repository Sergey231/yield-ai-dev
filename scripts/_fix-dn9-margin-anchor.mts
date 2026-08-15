/**
 * One-time correction of cycle #9's margin anchor (decibel_margin_open extra).
 *
 * The anchor inflated to ~$26.44 vs ~$18.43 actually committed: an overnight cron reduce freed
 * margin without decrementing the anchor (old behavior), then the add's grow re-counted the same
 * margin. The rehedge core now adjusts the anchor on every resize; this script resets #9's anchor
 * to the live committed margin (|size| × entry / leverage) as the correct starting point.
 *
 * Run from the worktree with env vars injected (no .env.local here):
 *   YIELD_AI_EXECUTOR_PRIVATE_KEY, APTOS_API_KEY, DECIBEL_API_KEY, DECIBEL_API_BASE_URL
 */
const SAFE = "0x23b329bff0ad2f462c7b212458cc0d1b20019af03766cde48bdc9f9d0a17617d";
const SUB = "0x971eee7f82d2ed4ed9633a2292165c74b354b7932d360a8fc56ed9fa47588fb6";
const CYCLE = "9";

async function main() {
  const { aptosClient, fetchDecibel } = await import("@/lib/protocols/decibel/lpDeltaNeutralOpen");
  const {
    CYCLE_MARGIN_OPEN_KEY,
    STRATEGY_JOURNAL_ENTRIES,
    fetchCycleExtraU64,
    fetchOpenCycles,
    strategyIdBytes,
  } = await import("@/lib/protocols/yield-ai/strategyJournal");
  const { submitExecutorEntryFunction } = await import("@/lib/protocols/decibel/executorSubmit");
  const { normalizeAddress, toCanonicalAddress } = await import("@/lib/utils/addressNormalization");

  const aptos = aptosClient();
  const cycle = (await fetchOpenCycles(aptos, SAFE)).find((c) => String(c.cycleId) === CYCLE);
  if (!cycle) throw new Error(`cycle #${CYCLE} is not open on this safe`);

  const positions = (await fetchDecibel(
    `/api/v1/account_positions?account=${encodeURIComponent(SUB)}`
  )) as Array<{ market?: string; size?: number; entry_price?: number; user_leverage?: number; is_deleted?: boolean }>;
  const want = normalizeAddress(toCanonicalAddress(cycle.perpMarket));
  const row = (Array.isArray(positions) ? positions : []).find(
    (p) =>
      p &&
      !p.is_deleted &&
      normalizeAddress(toCanonicalAddress(String(p.market || ""))) === want &&
      Number(p.size) < 0
  );
  if (!row) throw new Error("no live short on the cycle's market");

  const size = Math.abs(Number(row.size));
  const entry = Number(row.entry_price);
  const lev = Number(row.user_leverage) > 0 ? Number(row.user_leverage) : 1;
  const committedUsd = (size * entry) / lev;
  const next = BigInt(Math.round(committedUsd * 1e6));
  const prev = await fetchCycleExtraU64(aptos, SAFE, CYCLE, CYCLE_MARGIN_OPEN_KEY);

  console.log(
    JSON.stringify(
      {
        cycle: CYCLE,
        shortSize: size,
        entry,
        leverage: lev,
        committedUsd: Number(committedUsd.toFixed(4)),
        prevAnchorUsdc: prev != null ? Number(prev) / 1e6 : null,
        nextAnchorUsdc: Number(next) / 1e6,
      },
      null,
      2
    )
  );

  const hash = await submitExecutorEntryFunction({
    network: "mainnet",
    fn: STRATEGY_JOURNAL_ENTRIES.setCycleExtraU64,
    functionArguments: [SAFE, CYCLE, strategyIdBytes(CYCLE_MARGIN_OPEN_KEY), next],
    maxGasAmount: 30_000,
  });
  console.log("set_cycle_extra_u64 tx:", hash);

  const after = await fetchCycleExtraU64(aptos, SAFE, CYCLE, CYCLE_MARGIN_OPEN_KEY);
  console.log("anchor after:", after != null ? Number(after) / 1e6 : null);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
