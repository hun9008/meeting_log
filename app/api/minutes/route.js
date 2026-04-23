import { NextResponse } from "next/server";
import { extractBacklogItems } from "@/lib/backlog";
import { appendMinutesToSheet } from "@/lib/google";
import { createJiraBacklogItems } from "@/lib/jira";
import { passwordSession } from "@/lib/passwordAuth";

export const runtime = "nodejs";

function validatePayload(raw) {
  const payload = {
    date: String(raw.date || "").trim(),
    registrant: String(raw.registrant || "").trim(),
    topic: String(raw.topic || "").trim(),
    minutes: String(raw.minutes || "").trim(),
    plan: String(raw.plan || "").trim(),
    updateSheets: Boolean(raw.updateSheets)
  };

  const missing = ["date", "registrant", "plan"].filter((key) => !payload[key]);
  if (missing.length) {
    throw new Error(`Missing required fields: ${missing.join(", ")}`);
  }

  return payload;
}

export async function POST(request) {
  try {
    const session = await passwordSession();
    if (!session.authenticated) {
      return NextResponse.json({ ok: false, error: "비밀번호 인증이 필요합니다." }, { status: 401 });
    }

    const payload = validatePayload(await request.json());
    const items = extractBacklogItems(payload.plan);
    const jira = await createJiraBacklogItems(payload.plan);
    let sheet = { skipped: true, reason: "Google Sheets update is off." };

    if (payload.updateSheets) {
      sheet = await appendMinutesToSheet(payload);
      if (sheet.authRequired) {
        return NextResponse.json(
          {
            ok: false,
            authRequired: true,
            authUrl: sheet.authUrl,
            jira,
            items
          },
          { status: 401 }
        );
      }
    }

    return NextResponse.json({ ok: true, sheet, jira, items });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
