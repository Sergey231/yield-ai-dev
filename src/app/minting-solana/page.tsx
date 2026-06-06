"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/** Legacy route — unified into /minting?dest=solana. Kept for old links. */
function RedirectToMinting() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("dest", "solana");
    router.replace(`/minting?${params.toString()}`);
  }, [router, searchParams]);

  return <div className="container mx-auto p-6 max-w-6xl">Redirecting…</div>;
}

export default function MintingSolanaPage() {
  return (
    <Suspense fallback={<div className="container mx-auto p-6 max-w-6xl">Loading…</div>}>
      <RedirectToMinting />
    </Suspense>
  );
}
