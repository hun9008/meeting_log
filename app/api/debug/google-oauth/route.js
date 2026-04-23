import { NextResponse } from "next/server";
import { googleOAuthDebugInfo } from "@/lib/google";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(googleOAuthDebugInfo());
}
