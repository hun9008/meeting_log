import { NextResponse } from "next/server";
import { googleSession } from "@/lib/google";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await googleSession());
}
