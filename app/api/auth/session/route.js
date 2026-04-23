import { NextResponse } from "next/server";
import { passwordSession } from "@/lib/passwordAuth";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await passwordSession());
}
