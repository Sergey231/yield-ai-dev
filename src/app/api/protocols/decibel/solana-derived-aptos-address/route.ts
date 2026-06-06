import { NextRequest, NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import { SolanaDerivedPublicKey } from '@aptos-labs/derived-wallet-solana';
import { toCanonicalAddress } from '@/lib/utils/addressNormalization';

/** Same on-chain auth fn as Aptos Solana-derived wallets (`@aptos-labs/derived-wallet-solana` internal default). */
const SOLANA_DERIVED_AUTHENTICATION_FUNCTION = '0x1::solana_derivable_account::authenticate';

/** Host used by Decibel for Solana-derived Aptos (DAA); override via `domain` query to compare. */
const DEFAULT_DERIVATION_DOMAIN = 'app.decibel.trade';

function isSafeDerivationDomain(domain: string): boolean {
  if (domain.length < 1 || domain.length > 253) return false;
  return /^[a-zA-Z0-9.-]+$/.test(domain);
}

/**
 * GET /api/protocols/decibel/solana-derived-aptos-address
 *
 * Computes the Aptos Derivable Abstracted Account (DAA) address for a Solana pubkey
 * and dApp domain — pure derivation, no signing (same inputs as wallet adapter SIWS scope).
 *
 * Query:
 *   - solanaAddress (required): base58-encoded Solana public key
 *   - domain (optional): dApp host for accountIdentity; defaults to app.decibel.trade
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const solanaAddress = searchParams.get('solanaAddress')?.trim();
    const domainRaw = searchParams.get('domain')?.trim();
    const domain = domainRaw && domainRaw.length > 0 ? domainRaw : DEFAULT_DERIVATION_DOMAIN;

    if (!solanaAddress) {
      return NextResponse.json(
        { success: false, error: 'Query parameter solanaAddress is required (base58 Solana pubkey).' },
        { status: 400 }
      );
    }
    if (!isSafeDerivationDomain(domain)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid domain: use a hostname only (e.g. app.decibel.trade), no scheme or path.',
        },
        { status: 400 }
      );
    }

    let solanaPublicKey: PublicKey;
    try {
      solanaPublicKey = new PublicKey(solanaAddress);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid solanaAddress: not a valid base58 Solana public key.' },
        { status: 400 }
      );
    }

    const derived = new SolanaDerivedPublicKey({
      domain,
      solanaPublicKey,
      authenticationFunction: SOLANA_DERIVED_AUTHENTICATION_FUNCTION,
    });

    const aptosAddress = toCanonicalAddress(derived.authKey().derivedAddress().toString());

    return NextResponse.json({
      success: true,
      aptosAddress,
      solanaAddress: solanaPublicKey.toBase58(),
      domain,
      authenticationFunction: SOLANA_DERIVED_AUTHENTICATION_FUNCTION,
    });
  } catch (error) {
    console.error('[decibel] solana-derived-aptos-address error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to derive Aptos address',
      },
      { status: 500 }
    );
  }
}
