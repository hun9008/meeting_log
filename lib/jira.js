import { extractBacklogItems } from "./backlog";
import { loadDotEnv } from "./env";

export function jiraConfig() {
  loadDotEnv();

  const raw = (process.env.JIRA_API || "").trim();
  const config = {};

  if (raw.startsWith("{")) {
    try {
      Object.assign(config, JSON.parse(raw));
    } catch {
      // Keep falling back to explicit env vars.
    }
  } else if (raw.startsWith("http://") || raw.startsWith("https://")) {
    config.webhook_url = raw;
  } else if (raw) {
    config.api_token = raw;
  }

  return {
    webhook_url: process.env.JIRA_WEBHOOK_URL || config.webhook_url || "",
    base_url: process.env.JIRA_BASE_URL || config.base_url || "",
    email: process.env.JIRA_EMAIL || config.email || "",
    api_token: process.env.JIRA_API_TOKEN || config.api_token || "",
    project_key: process.env.JIRA_PROJECT_KEY || config.project_key || "DI",
    issue_type: process.env.JIRA_ISSUE_TYPE || config.issue_type || "Task",
    board_id: process.env.JIRA_BOARD_ID || String(config.board_id || "1"),
    assign_active_sprint: (process.env.JIRA_ASSIGN_ACTIVE_SPRINT || config.assign_active_sprint || "true") !== "false",
    space: process.env.JIRA_SPACE || config.space || "DI Lab"
  };
}

export function missingJiraConfig(config = jiraConfig()) {
  if (config.webhook_url) {
    return [];
  }
  return ["base_url", "email", "api_token", "project_key"].filter((key) => !config[key]);
}

export function jiraDebugInfo() {
  const config = jiraConfig();
  const missing = missingJiraConfig(config);
  return {
    configured: missing.length === 0,
    missing,
    hasWebhookUrl: Boolean(config.webhook_url),
    hasBaseUrl: Boolean(config.base_url),
    baseUrl: config.base_url,
    hasEmail: Boolean(config.email),
    hasApiToken: Boolean(config.api_token),
    projectKey: config.project_key,
    issueType: config.issue_type,
    boardId: config.board_id,
    assignActiveSprint: config.assign_active_sprint,
    space: config.space
  };
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

async function findActiveSprint(config, auth) {
  const params = new URLSearchParams({
    state: "active",
    maxResults: "50"
  });
  const result = await requestJson(
    `${config.base_url.replace(/\/$/, "")}/rest/agile/1.0/board/${config.board_id}/sprint?${params.toString()}`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  const sprints = result.values || [];
  if (!sprints.length) {
    return null;
  }

  return sprints.sort((a, b) => {
    const aTime = Date.parse(a.startDate || a.createdDate || 0) || 0;
    const bTime = Date.parse(b.startDate || b.createdDate || 0) || 0;
    return bTime - aTime;
  })[0];
}

async function addIssuesToActiveSprint(config, auth, issueKeys) {
  if (!config.assign_active_sprint || !issueKeys.length) {
    return { skipped: true, reason: "Active sprint assignment is off." };
  }

  const sprint = await findActiveSprint(config, auth);
  if (!sprint) {
    return { skipped: true, reason: `No active sprint found on board ${config.board_id}.` };
  }

  await requestJson(`${config.base_url.replace(/\/$/, "")}/rest/agile/1.0/sprint/${sprint.id}/issue`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}` },
    body: JSON.stringify({ issues: issueKeys })
  });

  return {
    sprintId: sprint.id,
    sprintName: sprint.name,
    issueKeys
  };
}

export async function createJiraBacklogItems(markdown) {
  const items = extractBacklogItems(markdown);
  if (!items.length) {
    return { created: [], skipped: true, reason: "No numbered plan items were found." };
  }

  const config = jiraConfig();
  if (config.webhook_url) {
    const result = await requestJson(config.webhook_url, {
      method: "POST",
      body: JSON.stringify({ boardId: 1, space: "DI Lab", items })
    });
    return { created: items.map((summary) => ({ summary })), result };
  }

  const missing = missingJiraConfig(config);
  if (missing.length) {
    return {
      created: [],
      skipped: true,
      reason: `Missing Jira config: ${missing.join(", ")}`,
      items
    };
  }

  const auth = Buffer.from(`${config.email}:${config.api_token}`, "utf8").toString("base64");
  const url = `${config.base_url.replace(/\/$/, "")}/rest/api/3/issue`;
  const created = [];

  for (const item of items) {
    const result = await requestJson(url, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        fields: {
          project: { key: config.project_key },
          summary: item,
          issuetype: { name: config.issue_type },
          labels: ["DI-Lab", "meeting-plan"],
          description: {
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: `Board: ${config.board_id} / Space: ${config.space}`
                  }
                ]
              }
            ]
          }
        }
      })
    });
    created.push({ summary: item, key: result.key, id: result.id });
  }

  const sprint = await addIssuesToActiveSprint(
    config,
    auth,
    created.map((issue) => issue.key).filter(Boolean)
  );

  return { created, sprint };
}
