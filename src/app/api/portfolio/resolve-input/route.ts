import { NextRequest, NextResponse } from "next/server";
import { Aptos, AptosConfig, Network, AccountAddress } from "@aptos-labs/ts-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  getDomainKeySync,
  getRecord,
  NameRegistryState,
  Record,
} from "@bonfida/spl-name-service";
import { getSafeSolanaRpcEndpoint } from "@/lib/solana/solanaRpcEndpoint";
import { isValidAptosAddress } from "@/lib/utils/aptosNames";

function normalizeAptosHex(addr: string): string {
  const s = addr.trim().toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(s)) return s;
  return s;
}

function isValidSolanaPubkeyString(s: string): boolean {
  try {
    new PublicKey(s.trim());
    return true;
  } catch {
    return false;
  }
}

async function resolveSolDomain(domainWithSol: string): Promise<string | null> {
  const domain = domainWithSol.trim().toLowerCase();
  if (!domain.endsWith(".sol")) return null;

  const rpc = getSafeSolanaRpcEndpoint();
  const connection = new Connection(rpc, "confirmed");

  try {
    const solRecord = await getRecord(connection, domain, Record.SOL, true);
    if (solRecord && typeof solRecord === "string" && solRecord.length > 0) {
      return new PublicKey(solRecord.trim()).toBase58();
    }
  } catch {
    // No SOL record or invalid — fall back to name owner
  }

  try {
    const { pubkey } = getDomainKeySync(domain);
    const { registry } = await NameRegistryState.retrieve(connection, pubkey);
    return registry.owner.toBase58();
  } catch {
    return null;
  }
}

async function resolveAptosAnsName(name: string): Promise<string | null> {
  const aptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
  try {
    const trimmed = name.trim();
    let target = await aptos.ans.getTargetAddress({ name: trimmed });
    if (target == null && trimmed !== trimmed.toLowerCase()) {
      target = await aptos.ans.getTargetAddress({ name: trimmed.toLowerCase() });
    }
    if (target == null) return null;
    const asText = typeof target === "string" ? target : String(target);
    const hex = asText.startsWith("0x") ? asText.toLowerCase() : `0x${asText}`.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(hex)) return null;
    return hex;
  } catch {
    return null;
  }
}

async function optionalAptosPrimaryLabel(address: string): Promise<string | null> {
  const aptos = new Aptos(new AptosConfig({ network: Network.MAINNET }));
  try {
    const name = await aptos.ans.getPrimaryName({
      address: AccountAddress.fromString(address),
    });
    return name && name.length > 0 ? name : null;
  } catch {
    return null;
  }
}

/**
 * POST { input: string } — classify Aptos vs Solana, resolve .apt / .sol to canonical addresses.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { input?: string };
    const raw = String(body?.input ?? "").trim();
    if (!raw) {
      return NextResponse.json({ error: "empty_input" }, { status: 400 });
    }

    const lower = raw.toLowerCase();

    if (isValidAptosAddress(raw)) {
      const hex = normalizeAptosHex(raw);
      const primary = await optionalAptosPrimaryLabel(hex);
      return NextResponse.json({
        aptosAddress: hex,
        aptosAnsLabel: primary,
      });
    }

    if (isValidSolanaPubkeyString(raw)) {
      const pk = new PublicKey(raw.trim());
      return NextResponse.json({ solanaAddress: pk.toBase58() });
    }

    if (lower.endsWith(".sol")) {
      const wallet = await resolveSolDomain(raw);
      if (!wallet) {
        return NextResponse.json({ error: "sol_domain_not_found" }, { status: 404 });
      }
      return NextResponse.json({
        solanaAddress: wallet,
        solanaDomainLabel: raw,
      });
    }

    if (lower.includes(".apt")) {
      const hex = await resolveAptosAnsName(raw);
      if (!hex) {
        return NextResponse.json({ error: "aptos_name_not_found" }, { status: 404 });
      }
      return NextResponse.json({
        aptosAddress: hex,
        aptosAnsLabel: raw,
      });
    }

    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  } catch (e) {
    console.error("[resolve-input]", e);
    return NextResponse.json({ error: "resolve_failed" }, { status: 500 });
  }
}
