import { NextResponse } from "next/server";
import { googleAuthUrl } from "@/lib/google";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.redirect(googleAuthUrl());
}
