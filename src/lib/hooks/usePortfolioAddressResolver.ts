import { useState, useEffect } from "react";

export interface PortfolioResolveResponse {
  aptosAddress?: string;
  solanaAddress?: string;
  aptosAnsLabel?: string | null;
  solanaDomainLabel?: string | null;
}

export interface UsePortfolioAddressResolverResult {
  /** Resolved Aptos account (0x + 64 hex), if any */
  aptosAddress: string;
  /** When user opened a Solana address/domain from URL — drives read-only Solana portfolio */
  solanaUrlAddress: string | null;
  /** ANS label to show (e.g. sadkov.apt) */
  aptosAnsLabel: string;
  /** SNS / .sol label */
  solanaDomainLabel: string;
  isLoading: boolean;
  error: string;
  /** True when input resolved only as Solana but Aptos field does not accept that (see options). */
  solanaOnlyAsAptosInput: boolean;
}

export interface UsePortfolioAddressResolverOptions {
  /** When true and input is blank, skip fetch and do not set an error (e.g. /portfolio/tracker before Aptos is chosen). */
  allowEmpty?: boolean;
  /**
   * When false, a response that is only a Solana address (no Aptos) is treated as wrong field:
   * no solanaUrlAddress is stored; use {@link solanaOnlyAsAptosInput} to show inline error.
   */
  acceptSolanaFromAptosInput?: boolean;
}

export function usePortfolioAddressResolver(
  input: string,
  options?: UsePortfolioAddressResolverOptions,
): UsePortfolioAddressResolverResult {
  const allowEmpty = options?.allowEmpty ?? false;
  const acceptSolanaFromAptosInput = options?.acceptSolanaFromAptosInput ?? true;
  const [aptosAddress, setAptosAddress] = useState("");
  const [solanaUrlAddress, setSolanaUrlAddress] = useState<string | null>(null);
  const [aptosAnsLabel, setAptosAnsLabel] = useState("");
  const [solanaDomainLabel, setSolanaDomainLabel] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [solanaOnlyAsAptosInput, setSolanaOnlyAsAptosInput] = useState(false);

  useEffect(() => {
    const run = async () => {
      setIsLoading(true);
      setError("");
      setSolanaOnlyAsAptosInput(false);
      setAptosAddress("");
      setSolanaUrlAddress(null);
      setAptosAnsLabel("");
      setSolanaDomainLabel("");

      if (!input.trim()) {
        if (allowEmpty) {
          setIsLoading(false);
          return;
        }
        setError("No address or domain provided");
        setIsLoading(false);
        return;
      }

      try {
        const res = await fetch("/api/portfolio/resolve-input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: input.trim() }),
        });
        const data = (await res.json()) as PortfolioResolveResponse & { error?: string };

        if (!res.ok) {
          if (data.error === "aptos_name_not_found" || data.error === "sol_domain_not_found") {
            setError(`Name or domain not found`);
          } else if (data.error === "invalid_input") {
            setError("Invalid Aptos wallet address or domain format");
          } else {
            setError("Could not resolve input");
          }
          setIsLoading(false);
          return;
        }

        if (data.solanaAddress && !data.aptosAddress && !acceptSolanaFromAptosInput) {
          setSolanaOnlyAsAptosInput(true);
          setIsLoading(false);
          return;
        }

        if (data.aptosAddress) {
          setAptosAddress(data.aptosAddress);
          if (data.aptosAnsLabel) setAptosAnsLabel(data.aptosAnsLabel);
        }
        if (data.solanaAddress) {
          setSolanaUrlAddress(data.solanaAddress);
          if (data.solanaDomainLabel) setSolanaDomainLabel(data.solanaDomainLabel);
        }

        if (!data.aptosAddress && !data.solanaAddress) {
          setError("Could not resolve input");
        }
      } catch (e) {
        console.error(e);
        setError("Error resolving address or domain");
      } finally {
        setIsLoading(false);
      }
    };

    void run();
  }, [input, allowEmpty, acceptSolanaFromAptosInput]);

  return {
    aptosAddress,
    solanaUrlAddress,
    aptosAnsLabel,
    solanaDomainLabel,
    isLoading,
    error,
    solanaOnlyAsAptosInput,
  };
}
