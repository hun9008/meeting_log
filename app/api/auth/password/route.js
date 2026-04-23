import { NextResponse } from "next/server";
import { sendGmailMessage } from "@/lib/google";
import {
  authLockMinutes,
  authLockStatus,
  clearPasswordFailures,
  configuredPassword,
  markSecurityAlertSent,
  maxAuthFailures,
  recordFailedPasswordAttempt,
  securityAlertEmail,
  setPasswordSession
} from "@/lib/passwordAuth";

export const runtime = "nodejs";

export async function POST(request) {
  const { password } = await request.json();
  const expected = configuredPassword();
  const lock = authLockStatus(request);

  if (!expected) {
    return NextResponse.json({ ok: false, error: "PASSWORD is not configured." }, { status: 500 });
  }

  if (lock.locked) {
    return NextResponse.json(
      { ok: false, error: `비밀번호 오류가 ${maxAuthFailures()}회 이상 발생해 ${authLockMinutes()}분 동안 사용이 제한됩니다.` },
      { status: 429 }
    );
  }

  if (password !== expected) {
    const failure = recordFailedPasswordAttempt(request);

    if (failure.shouldSendAlert) {
      try {
        await sendGmailMessage({
          to: securityAlertEmail(),
          subject: "[MEETING LOG] 비밀번호 오류 5회 초과",
          body: [
            "MEETING LOG 비밀번호 인증 실패가 5회 이상 발생했습니다.",
            "",
            `Client: ${failure.key}`,
            `Failed attempts: ${failure.count}`,
            `Locked minutes: ${authLockMinutes()}`,
            `Time: ${new Date().toISOString()}`
          ].join("\n")
        });
        markSecurityAlertSent(failure.key);
      } catch (error) {
        console.error("Failed to send security alert email:", error);
      }
    }

    if (failure.locked) {
      return NextResponse.json(
        { ok: false, error: `비밀번호 오류가 ${maxAuthFailures()}회 이상 발생해 ${authLockMinutes()}분 동안 사용이 제한됩니다.` },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { ok: false, error: `비밀번호가 올바르지 않습니다. ${failure.count}/${maxAuthFailures()}회 실패했습니다.` },
      { status: 401 }
    );
  }

  clearPasswordFailures(request);
  return setPasswordSession(NextResponse.json({ ok: true }));
}
