import { NextResponse } from "next/server";
import { jiraDebugInfo } from "@/lib/jira";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(jiraDebugInfo());
}
