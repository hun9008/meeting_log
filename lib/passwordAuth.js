import { cookies } from "next/headers";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadDotEnv } from "./env";

const AUTH_COOKIE = "meeting_auth";
const SECURITY_FILE = ".auth_security.json";

function securityPath() {
  return path.join(process.cwd(), SECURITY_FILE);
}

function readSecurityState() {
  if (!fs.existsSync(securityPath())) {
    return { attempts: {} };
  }

  try {
    return JSON.parse(fs.readFileSync(securityPath(), "utf8"));
  } catch {
    return { attempts: {} };
  }
}

function writeSecurityState(state) {
  fs.writeFileSync(securityPath(), JSON.stringify(state, null, 2));
}

export function configuredPassword() {
  loadDotEnv();
  return process.env.PASSWORD || "";
}

export function securityAlertEmail() {
  loadDotEnv();
  return process.env.SECURITY_ALERT_EMAIL || "younghune135@gmail.com";
}

export function maxAuthFailures() {
  loadDotEnv();
  return Number(process.env.AUTH_MAX_FAILURES || 5);
}

export function authLockMinutes() {
  loadDotEnv();
  return Number(process.env.AUTH_LOCK_MINUTES || 60);
}

function sessionValue() {
  const password = configuredPassword();
  if (!password) {
    return "";
  }
  const signature = crypto.createHmac("sha256", password).update("meeting-log-auth").digest("hex");
  return `v1.${signature}`;
}

export async function passwordSession() {
  const cookieStore = await cookies();
  return {
    authenticated: cookieStore.get(AUTH_COOKIE)?.value === sessionValue(),
    passwordConfigured: Boolean(configuredPassword())
  };
}

export async function setPasswordSession(response) {
  response.cookies.set(AUTH_COOKIE, sessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
  return response;
}

export function authClientKey(request) {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  return forwardedFor.split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}

export function authLockStatus(request) {
  const key = authClientKey(request);
  const state = readSecurityState();
  const entry = state.attempts?.[key];
  if (!entry?.lockedUntil) {
    return { locked: false, key };
  }

  if (Date.now() >= entry.lockedUntil) {
    delete state.attempts[key];
    writeSecurityState(state);
    return { locked: false, key };
  }

  return {
    locked: true,
    key,
    lockedUntil: entry.lockedUntil,
    remainingSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000)
  };
}

export function recordFailedPasswordAttempt(request) {
  const key = authClientKey(request);
  const state = readSecurityState();
  const now = Date.now();
  const current = state.attempts?.[key] || { count: 0, alertSent: false };
  const count = current.count + 1;
  const locked = count >= maxAuthFailures();
  const next = {
    ...current,
    count,
    lastFailedAt: now,
    lockedUntil: locked ? now + authLockMinutes() * 60 * 1000 : current.lockedUntil
  };

  state.attempts = {
    ...(state.attempts || {}),
    [key]: next
  };
  writeSecurityState(state);

  return {
    key,
    count,
    locked,
    lockedUntil: next.lockedUntil,
    shouldSendAlert: Boolean(locked && !current.alertSent)
  };
}

export function markSecurityAlertSent(key) {
  const state = readSecurityState();
  if (!state.attempts?.[key]) {
    return;
  }
  state.attempts[key].alertSent = true;
  writeSecurityState(state);
}

export function clearPasswordFailures(request) {
  const key = authClientKey(request);
  const state = readSecurityState();
  if (state.attempts?.[key]) {
    delete state.attempts[key];
    writeSecurityState(state);
  }
}
