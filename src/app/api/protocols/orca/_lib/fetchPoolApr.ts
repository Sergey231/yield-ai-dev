import {
  resolveOrcaPoolApr24hPct,
  resolveOrcaPoolAprPct,
  type OrcaPoolAprSource,
} from "@/lib/services/orca/poolApr";

const ORCA_API_BASE = "https://api.orca.so/v2/solana";

export type OrcaPoolAprMeta = {
  aprPct: number;
  apr24hPct: number;
};

async function fetchPoolApr(address: string): Promise<{ address: string; meta: OrcaPoolAprMeta } | null> {
  try {
    const response = await fetch(`${ORCA_API_BASE}/pools/${encodeURIComponent(address)}?stats=24h,7d`, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as { data?: OrcaPoolAprSource & { address?: string } } | null;
    const pool = payload?.data;
    if (!pool?.address) return null;
    const aprPct = resolveOrcaPoolAprPct(pool);
    const apr24hPct = resolveOrcaPoolApr24hPct(pool);
    if (!(aprPct > 0) && !(apr24hPct > 0)) return null;
    return {
      address: pool.address,
      meta: { aprPct, apr24hPct },
    };
  } catch {
    return null;
  }
}

export async function fetchOrcaPoolAprMap(poolAddresses: string[]): Promise<Map<string, OrcaPoolAprMeta>> {
  const unique = Array.from(new Set(poolAddresses.map((addr) => addr.trim()).filter(Boolean)));
  if (unique.length === 0) return new Map();

  const rows = await Promise.all(unique.map((address) => fetchPoolApr(address)));
  const out = new Map<string, OrcaPoolAprMeta>();
  for (const row of rows) {
    if (row) out.set(row.address, row.meta);
  }
  return out;
}
