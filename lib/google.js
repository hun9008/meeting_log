import fs from "node:fs";
import path from "node:path";
import { appBaseUrl, loadDotEnv } from "./env";
import { formatMarkdownForSheetRichText, formatPlanForSheetRichText } from "./backlog";

const TOKEN_FILE = ".google_token.json";
const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/spreadsheets"
];

function tokenPath() {
  return path.join(process.cwd(), TOKEN_FILE);
}

function oauthClient() {
  loadDotEnv();
  if (!process.env.CLIENT_SECRET_FILE) {
    throw new Error("Missing Google OAuth config: CLIENT_SECRET_FILE");
  }

  const fileName = path.basename(process.env.CLIENT_SECRET_FILE);
  const file = path.join(process.cwd(), fileName);
  if (!fs.existsSync(file)) {
    throw new Error(`Google OAuth client secret file was not found: ${fileName}`);
  }

  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return data.web || data.installed || data;
}

export function googleRedirectUri() {
  loadDotEnv();
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  return `${appBaseUrl()}/api/auth/google/callback`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${url} failed with ${response.status}: ${text}`);
  }
  return body;
}

export function googleAuthUrl() {
  const client = oauthClient();
  const params = new URLSearchParams({
    client_id: client.client_id,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent"
  });
  return `${client.auth_uri}?${params.toString()}`;
}

export async function exchangeGoogleCode(code) {
  const client = oauthClient();
  const params = new URLSearchParams({
    code,
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uri: googleRedirectUri(),
    grant_type: "authorization_code"
  });

  const response = await fetch(client.token_uri, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  const token = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(token));
  }

  const user = await googleUserInfo(token.access_token);
  assertAllowedGoogleUser(user.email);
  const savedToken = { ...token, user, saved_at: Math.floor(Date.now() / 1000) };
  fs.writeFileSync(tokenPath(), JSON.stringify(savedToken, null, 2));
  return savedToken;
}

export async function googleAccessToken() {
  loadDotEnv();
  if (!fs.existsSync(tokenPath())) {
    return null;
  }

  const token = JSON.parse(fs.readFileSync(tokenPath(), "utf8"));
  const expiresAt = (token.saved_at || 0) + (token.expires_in || 0) - 60;
  if (token.access_token && Math.floor(Date.now() / 1000) < expiresAt) {
    return token.access_token;
  }

  if (!token.refresh_token) {
    return null;
  }

  const client = oauthClient();
  const params = new URLSearchParams({
    client_id: client.client_id,
    client_secret: client.client_secret,
    refresh_token: token.refresh_token,
    grant_type: "refresh_token"
  });

  const response = await fetch(client.token_uri, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params
  });
  const refreshed = await response.json();
  if (!response.ok) {
    return null;
  }

  const nextToken = { ...refreshed, refresh_token: token.refresh_token, user: token.user, saved_at: Math.floor(Date.now() / 1000) };
  fs.writeFileSync(tokenPath(), JSON.stringify(nextToken, null, 2));
  return nextToken.access_token;
}

export function allowedGoogleEmail() {
  loadDotEnv();
  return (process.env.ALLOWED_GOOGLE_EMAIL || "younghune135@gmail.com").trim().toLowerCase();
}

function assertAllowedGoogleUser(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || normalized !== allowedGoogleEmail()) {
    throw new Error(`Google account is not allowed: ${email || "unknown"}`);
  }
}

async function googleUserInfo(accessToken) {
  return requestJson("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

export async function googleSession() {
  const accessToken = await googleAccessToken();
  if (!accessToken || !fs.existsSync(tokenPath())) {
    return { authenticated: false, allowedEmail: allowedGoogleEmail() };
  }

  const token = JSON.parse(fs.readFileSync(tokenPath(), "utf8"));
  let user = token.user;
  if (!user?.email) {
    try {
      user = await googleUserInfo(accessToken);
      const nextToken = { ...token, user };
      fs.writeFileSync(tokenPath(), JSON.stringify(nextToken, null, 2));
    } catch {
      return { authenticated: false, allowedEmail: allowedGoogleEmail() };
    }
  }

  const email = String(user.email || "").trim().toLowerCase();
  const allowed = email === allowedGoogleEmail();
  return {
    authenticated: allowed,
    email,
    allowedEmail: allowedGoogleEmail()
  };
}

function spreadsheetIdFromEnv() {
  loadDotEnv();
  if (process.env.GOOGLE_SPREADSHEET_ID) {
    return process.env.GOOGLE_SPREADSHEET_ID;
  }

  throw new Error("Missing Google Sheets config: GOOGLE_SPREADSHEET_ID");
}

function sheetTabFromEnv() {
  loadDotEnv();
  if (process.env.GOOGLE_SHEET_TAB) {
    return process.env.GOOGLE_SHEET_TAB;
  }

  throw new Error("Missing Google Sheets config: GOOGLE_SHEET_TAB");
}

async function firstEmptySheetRow(accessToken, spreadsheetId, tab) {
  const rangeName = encodeURIComponent(`'${tab}'!A:F`);
  const result = await requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${rangeName}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const rows = result.values || [];

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (!row.some((cell) => String(cell || "").trim())) {
      return index + 1;
    }
  }

  return rows.length + 1;
}

async function sheetIdByTitle(accessToken, spreadsheetId, tab) {
  const result = await requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(sheetId,title)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const sheet = result.sheets?.find((entry) => entry.properties?.title === tab);
  return sheet?.properties?.sheetId ?? 0;
}

async function applyCellRichText(accessToken, spreadsheetId, tab, rowNumber, columnIndex, richText) {
  if (!richText.boldRanges.length) {
    return null;
  }

  const sheetId = await sheetIdByTitle(accessToken, spreadsheetId, tab);
  const textFormatRuns = [];
  let lastIndex = 0;

  for (const range of richText.boldRanges) {
    if (range.start > lastIndex) {
      textFormatRuns.push({ startIndex: lastIndex, format: { bold: false } });
    }
    textFormatRuns.push({ startIndex: range.start, format: { bold: true } });
    textFormatRuns.push({ startIndex: range.end, format: { bold: false } });
    lastIndex = range.end;
  }

  const result = await requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        requests: [
          {
            updateCells: {
              range: {
                sheetId,
                startRowIndex: rowNumber - 1,
                endRowIndex: rowNumber,
                startColumnIndex: columnIndex,
                endColumnIndex: columnIndex + 1
              },
              rows: [
                {
                  values: [
                    {
                      userEnteredValue: { stringValue: richText.text },
                      textFormatRuns
                    }
                  ]
                }
              ],
              fields: "userEnteredValue,textFormatRuns"
            }
          }
        ]
      })
    }
  );

  return result;
}

export async function appendMinutesToSheet(payload) {
  const accessToken = await googleAccessToken();
  if (!accessToken) {
    return { authRequired: true, authUrl: googleAuthUrl() };
  }

  const spreadsheetId = spreadsheetIdFromEnv();
  const tab = sheetTabFromEnv();
  const rowNumber = await firstEmptySheetRow(accessToken, spreadsheetId, tab);
  const minutesRichText = formatMarkdownForSheetRichText(payload.minutes || "");
  const planRichText = formatPlanForSheetRichText(payload.plan);
  const values = [[
    payload.date,
    payload.registrant,
    payload.topic || "",
    minutesRichText.text,
    planRichText.text
  ]];

  const params = new URLSearchParams({
    valueInputOption: "USER_ENTERED"
  });
  const rangeName = encodeURIComponent(`'${tab}'!A${rowNumber}:E${rowNumber}`);
  const result = await requestJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${rangeName}?${params.toString()}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ values })
    }
  );
  await applyCellRichText(accessToken, spreadsheetId, tab, rowNumber, 3, minutesRichText);
  await applyCellRichText(accessToken, spreadsheetId, tab, rowNumber, 4, planRichText);

  return {
    spreadsheetId,
    sheetTab: tab,
    updatedRange: result.updatedRange,
    rowNumber
  };
}

export function googleOAuthDebugInfo() {
  const client = oauthClient();
  loadDotEnv();
  return {
    clientId: client.client_id,
    redirectUri: googleRedirectUri(),
    allowedEmail: allowedGoogleEmail(),
    clientSecretFile: process.env.CLIENT_SECRET_FILE || "",
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || "",
    sheetTab: process.env.GOOGLE_SHEET_TAB || "",
    configuredRedirectUris: client.redirect_uris || [],
    configuredJavaScriptOrigins: client.javascript_origins || [],
    authUrl: googleAuthUrl()
  };
}
