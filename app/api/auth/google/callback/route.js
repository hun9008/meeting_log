import { NextResponse } from "next/server";
import { exchangeGoogleCode } from "@/lib/google";
import { appBaseUrl } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.json({ ok: false, error: "Missing OAuth code" }, { status: 400 });
  }

  try {
    await exchangeGoogleCode(code);
    return NextResponse.redirect(`${appBaseUrl()}/?google=connected`);
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }
}
