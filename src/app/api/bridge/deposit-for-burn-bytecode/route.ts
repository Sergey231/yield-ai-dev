import { NextResponse } from "next/server";

const BYTECODE_URL =
  "https://raw.githubusercontent.com/circlefin/aptos-cctp/master/typescript/example/precompiled-move-scripts/mainnet/deposit_for_burn.mv";

export async function GET() {
  const upstream = await fetch(BYTECODE_URL, {
    // Keep this route resilient against transient upstream issues.
    cache: "no-store",
  });

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: `Failed to load bytecode upstream: ${upstream.status} ${upstream.statusText}`,
      },
      { status: 502 }
    );
  }

  const bytes = await upstream.arrayBuffer();

  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      // Cache in the browser/CDN since this file changes rarely, but allow fast updates.
      "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

