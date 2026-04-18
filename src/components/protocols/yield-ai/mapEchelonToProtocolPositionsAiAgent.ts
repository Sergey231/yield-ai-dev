import type { ProtocolPosition } from "@/shared/ProtocolCard/types";

const ECHELON_LOGO_URL = "/protocol_ico/echelon.png";

/**
 * AI agent card: stack Echelon protocol logo + underlying token (same idea as Moar rows).
 */
export function mapEchelonProtocolPositionsToAiAgent(
  positions: ProtocolPosition[]
): ProtocolPosition[] {
  return positions
    .map((p) => ({
      ...p,
      logoUrl2: p.logoUrl,
      logoUrl: ECHELON_LOGO_URL,
    }))
    .sort((a, b) => b.value - a.value);
}
