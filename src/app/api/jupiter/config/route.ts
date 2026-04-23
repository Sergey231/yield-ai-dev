import { NextResponse } from "next/server";
import { getPlatformFeeBps } from "@/app/api/jupiter/_lib";

export async function GET() {
  try {
    return NextResponse.json({ platformFeeBps: getPlatformFeeBps() }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, platformFeeBps: 0 }, { status: 500 });
  }
}

