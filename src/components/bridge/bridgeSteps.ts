import type { ActionLogItem } from './ActionLog';

export type StepStatus = 'pending' | 'active' | 'done' | 'error';
export type StepKey = 'initiate' | 'lock' | 'attest' | 'mint';

export interface CanonicalStep {
  key: StepKey;
  label: string;
  status: StepStatus;
  /** Latest matching action log entry (for link, duration, error message). */
  source?: ActionLogItem;
}

export interface BridgeStepsResult {
  steps: CanonicalStep[];
  /** Convenience: index of the currently active step, or -1 when all done. */
  activeIndex: number;
  /** True when every step is `done`. */
  allDone: boolean;
  /** Any error message surfaced by the log. */
  errorMessage?: string;
}

/** Lowercased keyword fingerprints — order matters for `mint` (most specific first). */
const PATTERNS: Record<StepKey, RegExp[]> = {
  initiate: [
    /^initializing/i,
    /^starting .* bridge/i,
    /burn transaction/i,
    /burn completed/i,
    /^bridge complete/i, // terminal — counts as initiate-done too
  ],
  lock: [
    /waiting for (solana|aptos) transaction confirmation/i,
    /waiting for (solana|aptos) confirmation/i,
    /(solana|aptos) transaction confirmed/i,
  ],
  attest: [
    /requesting attestation/i,
    /waiting for attestation/i,
    /attestation received/i,
  ],
  mint: [
    /preparing mint/i,
    /minting on (solana|aptos)/i,
    /retrying mint/i,
    /reconnecting and retrying mint/i,
    /usdc minted successfully/i,
    /attestation received and minting completed/i,
    /mint manually/i,
  ],
};

function findLatestMatch(items: ActionLogItem[], patterns: RegExp[]): ActionLogItem | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (patterns.some((p) => p.test(it.message))) return it;
  }
  return undefined;
}

/** Marker that the whole bridge wrapped up successfully. */
function hasBridgeComplete(items: ActionLogItem[]): boolean {
  return items.some(
    (it) =>
      it.status === 'success' &&
      (/^bridge complete!?$/i.test(it.message) ||
        /usdc minted successfully/i.test(it.message)),
  );
}

export function deriveBridgeSteps(
  items: ActionLogItem[],
  direction: 'solana-to-aptos' | 'aptos-to-solana',
): BridgeStepsResult {
  const sourceChain = direction === 'solana-to-aptos' ? 'Solana' : 'Aptos';
  const destChain = direction === 'solana-to-aptos' ? 'Aptos' : 'Solana';

  const initiateMatch = findLatestMatch(items, PATTERNS.initiate);
  const lockMatch = findLatestMatch(items, PATTERNS.lock);
  const attestMatch = findLatestMatch(items, PATTERNS.attest);
  const mintMatch = findLatestMatch(items, PATTERNS.mint);

  const errorItem = [...items].reverse().find((it) => it.status === 'error');
  const bridgeComplete = hasBridgeComplete(items);

  const burnConfirmed = items.some(
    (it) =>
      it.status === 'success' &&
      (/burn completed/i.test(it.message) ||
        /(solana|aptos) transaction confirmed/i.test(it.message)),
  );
  const attestReceived = items.some(
    (it) => it.status === 'success' && /attestation received/i.test(it.message),
  );
  const minted = items.some(
    (it) =>
      it.status === 'success' &&
      /(usdc minted successfully|attestation received and minting completed)/i.test(it.message),
  );

  // Determine status per step using "done" markers + the latest matching item.
  const statusFor = (key: StepKey): StepStatus => {
    // hard "done" gates
    if (key === 'initiate' && (burnConfirmed || attestReceived || minted)) return 'done';
    if (key === 'lock' && (burnConfirmed || attestReceived || minted)) return 'done';
    if (key === 'attest' && (attestReceived || minted)) return 'done';
    if (key === 'mint' && minted) return 'done';

    const map: Record<StepKey, ActionLogItem | undefined> = {
      initiate: initiateMatch,
      lock: lockMatch,
      attest: attestMatch,
      mint: mintMatch,
    };
    const it = map[key];
    if (!it) return 'pending';
    if (it.status === 'error') return 'error';
    if (it.status === 'success') return 'done';
    return 'active';
  };

  const steps: CanonicalStep[] = [
    {
      key: 'initiate',
      label: `Initiating transaction on ${sourceChain}`,
      status: statusFor('initiate'),
      source: initiateMatch,
    },
    {
      key: 'lock',
      label: `Locking USDC in bridge contract`,
      status: statusFor('lock'),
      source: lockMatch,
    },
    {
      key: 'attest',
      label: `Awaiting cross-chain confirmation`,
      status: statusFor('attest'),
      source: attestMatch,
    },
    {
      key: 'mint',
      label: `Minting USDC on ${destChain}`,
      status: statusFor('mint'),
      source: mintMatch,
    },
  ];

  // Ensure single active step: if an earlier step is "pending" but a later one is "done",
  // backfill earlier steps to "done".
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].status === 'done') {
      for (let j = 0; j < i; j++) {
        if (steps[j].status === 'pending') steps[j].status = 'done';
      }
      break;
    }
  }

  // If there's an error item but no step caught it, attach to the latest non-done step.
  if (errorItem) {
    const idx = steps.findIndex((s) => s.status !== 'done');
    if (idx >= 0) {
      steps[idx].status = 'error';
      steps[idx].source = steps[idx].source ?? errorItem;
    }
  }

  // Promote a single "pending" → "active" if nothing else is active and we're still in-flight.
  if (!bridgeComplete) {
    const hasActive = steps.some((s) => s.status === 'active');
    if (!hasActive) {
      const idx = steps.findIndex((s) => s.status === 'pending');
      if (idx >= 0) steps[idx].status = 'active';
    }
  }

  const activeIndex = steps.findIndex((s) => s.status === 'active');
  const allDone = steps.every((s) => s.status === 'done');

  return {
    steps,
    activeIndex,
    allDone,
    errorMessage: errorItem?.message,
  };
}

/** Format ms duration as "1m 47s" / "23s". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
