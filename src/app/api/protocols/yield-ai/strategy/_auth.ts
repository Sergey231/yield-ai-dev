import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse } from "@/lib/utils/http";

export function requireStrategyMutationSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.YIELD_AI_CRON_SECRET;
  const provided = request.headers.get("x-cron-secret");

  if (!secret) {
    return NextResponse.json(
      createErrorResponse(new Error("YIELD_AI_CRON_SECRET is not configured on the server")),
      { status: 500 }
    );
  }

  if (!provided || provided !== secret) {
    return NextResponse.json(createErrorResponse(new Error("Unauthorized")), { status: 401 });
  }

  return null;
}
