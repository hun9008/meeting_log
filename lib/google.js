import fs from "node:fs";
import path from "node:path";
import { appBaseUrl, loadDotEnv } from "./env";
import { formatMarkdownForSheetRichText, formatPlanForSheetRichText } from "./backlog";

const TOKEN_FILE = ".google_token.json";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
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
  let body = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    const detail =
      typeof body.error === "string"
        ? body.error
        : typeof body.raw === "string"
          ? body.raw.slice(0, 300)
          : text.slice(0, 300);
    throw new Error(`${options.method || "GET"} ${url} failed with ${response.status}: ${detail}`);
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
  const text = await response.text();
  let token = {};

  try {
    token = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Google OAuth token response was not valid JSON: ${text.slice(0, 300)}`);
  }

  if (!response.ok) {
    throw new Error(JSON.stringify(token));
  }

  const savedToken = { ...token, saved_at: Math.floor(Date.now() / 1000) };
  fs.writeFileSync(tokenPath(), JSON.stringify(savedToken, null, 2));
  return savedToken;
}

export async function googleAccessToken() {
  loadDotEnv();
  if (!fs.existsSync(tokenPath())) {
    return null;
  }

  let token;

  try {
    token = JSON.parse(fs.readFileSync(tokenPath(), "utf8"));
  } catch {
    throw new Error("Google OAuth token file is invalid. Delete .google_token.json and authenticate again.");
  }

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
  const text = await response.text();
  let refreshed = {};

  try {
    refreshed = text ? JSON.parse(text) : {};
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const nextToken = { ...refreshed, refresh_token: token.refresh_token, saved_at: Math.floor(Date.now() / 1000) };
  fs.writeFileSync(tokenPath(), JSON.stringify(nextToken, null, 2));
  return nextToken.access_token;
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
  const warnings = [];

  try {
    await applyCellRichText(accessToken, spreadsheetId, tab, rowNumber, 3, minutesRichText);
  } catch (error) {
    warnings.push(`회의록 서식 적용 실패: ${error.message}`);
  }

  try {
    await applyCellRichText(accessToken, spreadsheetId, tab, rowNumber, 4, planRichText);
  } catch (error) {
    warnings.push(`다음 할 일 서식 적용 실패: ${error.message}`);
  }

  return {
    spreadsheetId,
    sheetTab: tab,
    updatedRange: result.updatedRange,
    rowNumber,
    warnings
  };
}

export function googleOAuthDebugInfo() {
  const client = oauthClient();
  loadDotEnv();
  return {
    clientId: client.client_id,
    redirectUri: googleRedirectUri(),
    clientSecretFile: process.env.CLIENT_SECRET_FILE || "",
    spreadsheetId: process.env.GOOGLE_SPREADSHEET_ID || "",
    sheetTab: process.env.GOOGLE_SHEET_TAB || "",
    configuredRedirectUris: client.redirect_uris || [],
    configuredJavaScriptOrigins: client.javascript_origins || [],
    authUrl: googleAuthUrl()
  };
}

function base64Url(value) {
  return Buffer.from(value, "utf8").toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function sendGmailMessage({ to, subject, body }) {
  const accessToken = await googleAccessToken();
  if (!accessToken) {
    throw new Error("Google OAuth token is required to send Gmail alerts.");
  }

  const raw = [
    `To: ${to}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    "",
    body
  ].join("\r\n");

  return requestJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ raw: base64Url(raw) })
  });
}
