import { NextResponse } from "next/server";
import { isLikelySolanaAddress } from "@/lib/kamino/kvaultVaultAddress";
import {
  buildKaminoFarmClaimTransactionBase64,
  buildKaminoVaultClaimTransactionBase64,
} from "@/lib/solana/kaminoClaimServer";

type ClaimTxBody = {
  signer?: unknown;
  source?: unknown;
  farmPubkey?: unknown;
  vaultAddress?: unknown;
  isDelegated?: unknown;
  delegatees?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as ClaimTxBody | null;
    const signer = typeof body?.signer === "string" ? body.signer.trim() : "";
    const source = typeof body?.source === "string" ? body.source.trim() : "";

    if (!signer) {
      return NextResponse.json({ success: false, error: "Missing signer" }, { status: 400 });
    }
    if (!isLikelySolanaAddress(signer)) {
      return NextResponse.json({ success: false, error: "Invalid signer address" }, { status: 400 });
    }

    if (source === "farm") {
      const farmPubkey = typeof body?.farmPubkey === "string" ? body.farmPubkey.trim() : "";
      if (!farmPubkey) {
        return NextResponse.json({ success: false, error: "Missing farmPubkey" }, { status: 400 });
      }
      const isDelegated = body?.isDelegated === true;
      const delegatees = Array.isArray(body?.delegatees)
        ? body.delegatees.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
        : undefined;

      const { transactionBase64 } = await buildKaminoFarmClaimTransactionBase64({
        ownerBase58: signer,
        farmPubkey,
        isDelegated,
        delegatees,
      });
      return NextResponse.json({ success: true, data: { transaction: transactionBase64 } });
    }

    if (source === "vault") {
      const vaultAddress = typeof body?.vaultAddress === "string" ? body.vaultAddress.trim() : "";
      if (!vaultAddress) {
        return NextResponse.json({ success: false, error: "Missing vaultAddress" }, { status: 400 });
      }

      const { transactionBase64 } = await buildKaminoVaultClaimTransactionBase64({
        ownerBase58: signer,
        vaultAddress,
      });
      return NextResponse.json({ success: true, data: { transaction: transactionBase64 } });
    }

    return NextResponse.json({ success: false, error: "Invalid source (expected farm or vault)" }, { status: 400 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
