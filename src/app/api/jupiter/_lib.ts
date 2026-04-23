import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";

export function stripEnv(s: string): string {
  return s.replace(/^["']|["']$/g, "").trim();
}

/** Server-side RPC URL. Uses full URL; if no api-key in URL, appends SOLANA_RPC_API_KEY. */
export function getSolanaRpcUrl(): string {
  const fullUrl = stripEnv(process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "");
  const apiKey = stripEnv(process.env.SOLANA_RPC_API_KEY || process.env.NEXT_PUBLIC_SOLANA_RPC_API_KEY || "");

  if (fullUrl) {
    const hasKey = /[?&](api[_-]?key|token)=/i.test(fullUrl);
    if (hasKey) return fullUrl;
    if (apiKey) {
      const sep = fullUrl.includes("?") ? "&" : "?";
      return `${fullUrl}${sep}api-key=${apiKey}`;
    }
    return fullUrl;
  }

  if (apiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  }
  return "https://api.mainnet-beta.solana.com";
}

export function getServerSolanaConnection(): Connection {
  return new Connection(getSolanaRpcUrl(), "confirmed");
}

export function getJupiterSwapBaseUrl(): string {
  return stripEnv(process.env.JUPITER_SWAP_API_BASE || "https://api.jup.ag/swap/v2") || "https://api.jup.ag/swap/v2";
}

export function getJupiterApiKey(): string {
  return stripEnv(process.env.JUPITER_API_KEY || process.env.JUP_API_KEY || "");
}

export function getSolanaPayerKeypair(): { keypair: Keypair; address: string } {
  const payerPk = stripEnv(process.env.SOLANA_PAYER_WALLET_PRIVATE_KEY || "");
  const payerAddressEnv = stripEnv(process.env.SOLANA_PAYER_WALLET_ADDRESS || "");
  if (!payerPk) {
    throw new Error("Missing SOLANA_PAYER_WALLET_PRIVATE_KEY on the server");
  }
  const keypair = Keypair.fromSecretKey(bs58.decode(payerPk));
  const derived = keypair.publicKey.toBase58();
  if (payerAddressEnv && derived !== payerAddressEnv) {
    throw new Error(`Fee payer address mismatch: key derives to ${derived}, env expects ${payerAddressEnv}`);
  }
  return { keypair, address: derived };
}

export function getPlatformFeeBps(): number {
  const raw = stripEnv(process.env.JUPITER_PLATFORM_FEE_BPS || "1");
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.max(0, Math.min(10000, Math.floor(n)));
}

export function getFeeOwner(): PublicKey {
  const raw = stripEnv(process.env.JUPITER_FEE_OWNER || "");
  if (!raw) throw new Error("Missing JUPITER_FEE_OWNER on the server");
  return new PublicKey(raw);
}

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export async function deriveAtaAddress({
  owner,
  mint,
}: {
  owner: PublicKey;
  mint: PublicKey;
}): Promise<PublicKey> {
  const [ata] = await PublicKey.findProgramAddress(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

export function createAtaIx({
  payer,
  owner,
  mint,
  ata,
}: {
  payer: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  ata: PublicKey;
}): TransactionInstruction {
  // Associated Token Program create instruction has empty data
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("11111111111111111111111111111111"), isSigner: false, isWritable: false }, // SystemProgram
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: new PublicKey("SysvarRent111111111111111111111111111111111"), isSigner: false, isWritable: false },
    ],
    data: Buffer.alloc(0),
  });
}

