"use client";

import { useEffect, useMemo, useState } from "react";

const sampleMinutes = `# 논의 내용
- 최근 실험 결과를 확인함
- PPT 반영사항과 다음 액션을 정리함`;

const samplePlan = `# PPT 반영사항
1. injection 대상 (victim item) victim은 아닌것 같고 더 적절한 naming 필요
2. degradation 재분류 (imperceptibility)
3. image where 조사 후 categorize

# MMRS attack
1. Local manip policy가 기존 refer인지, refer라면 빠진게 있는지 확인 필요.
2. RS or MMRS attack dataset 중 image가 하나의 item만 들어있는 데이터인지 여러 item이 동시에 등장하는지 조사
3. HR, NDCG 계산 방식이 10개 평균일때 target 1개씩 10번 평균인지 target 10개 score 평균인지 조사

# AnchorRec Exp
1. silhouette, Calinski 에서 cluster 의 유의미 여부가 MI과 상관있는지 고민
2. cluster analysis에 k 사이즈를 더 키우거나 elbow method 기준 k 선택 방식으로 다시 확인 필요`;

const DRAFT_STORAGE_KEY = "meeting-log-drafts";
const AUTO_SAVE_STORAGE_KEY = "meeting-log-autosave";
const MAX_DRAFTS = 20;
const DEFAULT_FORM = {
  date: "",
  registrant: "정용훈",
  topic: "",
  minutes: "",
  plan: "",
  updateSheets: true
};

function normalizeForm(raw = {}) {
  return {
    date: String(raw.date || "").trim(),
    registrant: String(raw.registrant || DEFAULT_FORM.registrant).trim() || DEFAULT_FORM.registrant,
    topic: String(raw.topic || ""),
    minutes: String(raw.minutes || ""),
    plan: String(raw.plan || ""),
    updateSheets: raw.updateSheets ?? true
  };
}

function hasRestorableContent(form) {
  return Boolean(form.topic || form.minutes || form.plan);
}

function todayInSeoul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function formatDraftTime(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(new Date(value));
}

function extractBacklogItems(markdown) {
  let heading = "";
  const items = [];

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      heading = headingMatch[1].trim();
      continue;
    }

    const itemMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (itemMatch) {
      const text = itemMatch[1].trim();
      items.push(heading ? `[${heading}] ${text}` : text);
    }
  }

  return items;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

function markdownToHtml(markdown) {
  const html = [];
  let list = null;

  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 3);
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      if (list !== "ol") {
        closeList();
        list = "ol";
        html.push("<ol>");
      }
      html.push(`<li>${inlineMarkdown(ordered[1])}</li>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      if (list !== "ul") {
        closeList();
        list = "ul";
        html.push("<ul>");
      }
      html.push(`<li>${inlineMarkdown(unordered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
  }

  closeList();
  return html.join("");
}

export default function Home() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const [preview, setPreview] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [session, setSession] = useState({ loading: true, authenticated: false, passwordConfigured: false });
  const [password, setPassword] = useState("");
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((response) => response.json())
      .then((data) => setSession({ loading: false, ...data }))
      .catch(() => setSession({ loading: false, authenticated: false, passwordConfigured: false }));
  }, []);

  useEffect(() => {
    setForm((current) => (current.date ? current : { ...current, date: todayInSeoul() }));
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_STORAGE_KEY) || "[]");
      setDrafts(Array.isArray(saved) ? saved : []);

      const autoSaved = JSON.parse(localStorage.getItem(AUTO_SAVE_STORAGE_KEY) || "null");
      const restoredForm = normalizeForm(autoSaved?.form);
      if (hasRestorableContent(restoredForm)) {
        setForm((current) => ({
          ...current,
          ...restoredForm,
          date: restoredForm.date || current.date || todayInSeoul()
        }));
        setToast({ type: "success", text: "이전에 작성 중이던 내용을 복원했습니다." });
      }
    } catch {
      setDrafts([]);
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    const normalized = normalizeForm(form);
    if (hasRestorableContent(normalized)) {
      localStorage.setItem(
        AUTO_SAVE_STORAGE_KEY,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          form: normalized
        })
      );
      return;
    }

    localStorage.removeItem(AUTO_SAVE_STORAGE_KEY);
  }, [form, storageReady]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "connected") {
      setToast({ type: "success", text: "Google Sheets 연결이 완료되었습니다." });
      window.history.replaceState({}, "", "/");
    }
  }, []);

  const backlogItems = useMemo(() => extractBacklogItems(form.plan), [form.plan]);
  const minutesPreview = useMemo(() => markdownToHtml(form.minutes), [form.minutes]);

  function updateField(event) {
    const { name, type, checked, value } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  function fillSample() {
    setForm((current) => ({
      ...current,
      topic: current.topic || "DI Lab 미팅",
      minutes: sampleMinutes,
      plan: samplePlan
    }));
  }

  function saveDraft() {
    const now = new Date().toISOString();
    const draft = {
      id: now,
      savedAt: now,
      form: normalizeForm(form)
    };
    const nextDrafts = [draft, ...drafts].slice(0, MAX_DRAFTS);
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(nextDrafts));
    setDrafts(nextDrafts);
    setSelectedDraftId(draft.id);
    setToast({ type: "success", text: "임시 저장했습니다." });
  }

  function loadDraft(event) {
    const id = event.target.value;
    setSelectedDraftId(id);
    const draft = drafts.find((entry) => entry.id === id);
    if (!draft) {
      return;
    }
    setForm({ ...normalizeForm(draft.form), date: draft.form.date || todayInSeoul() });
    setToast({ type: "success", text: `${formatDraftTime(draft.savedAt)} 임시 저장을 불러왔습니다.` });
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setToast(null);

    try {
      const response = await fetch("/api/minutes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const result = await response.json();

      if (result.authRequired) {
        localStorage.setItem(
          AUTO_SAVE_STORAGE_KEY,
          JSON.stringify({
            savedAt: new Date().toISOString(),
            form: normalizeForm(form)
          })
        );
        const jiraText = result.jira?.created?.length
          ? `Jira ${result.jira.created.length}개는 생성되었습니다. `
          : "";
        setToast({ type: "warn", text: `${jiraText}Google Sheets 인증으로 이동합니다.` });
        window.setTimeout(() => {
          window.location.href = result.authUrl;
        }, 900);
        return;
      }

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "등록에 실패했습니다.");
      }

      const sheetsText = form.updateSheets ? "Sheets 업데이트 완료, " : "Sheets 업데이트 건너뜀, ";
      if (result.jira?.skipped) {
        setToast({ type: "warn", text: `${sheetsText}Jira 미반영: ${result.jira.reason}` });
        return;
      }

      const jiraCount = result.jira?.created?.length || 0;
      const sprintText = result.jira?.sprint?.skipped
        ? ` Sprint 미할당: ${result.jira.sprint.reason}`
        : result.jira?.sprint?.sprintName
          ? ` Sprint: ${result.jira.sprint.sprintName}.`
          : "";
      localStorage.removeItem(AUTO_SAVE_STORAGE_KEY);
      setToast({ type: "success", text: `${sheetsText}Jira ${jiraCount}개 생성 완료.${sprintText}` });
    } catch (error) {
      setToast({ type: "warn", text: error.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function login(event) {
    event.preventDefault();
    setToast(null);

    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "로그인에 실패했습니다.");
      }
      setSession((current) => ({ ...current, authenticated: true }));
      setPassword("");
      setToast({ type: "success", text: "로그인했습니다." });
    } catch (error) {
      setToast({ type: "warn", text: error.message });
    }
  }

  return (
    <main className="appShell">
      <section className="workspace">
        <header className="topbar">
          <h1>MEETING LOG</h1>
          {session.authenticated ? (
            <a className="googleButton" href="/api/auth/google/start" title="Google Sheets 연결" aria-label="Google Sheets 연결">
              G
            </a>
          ) : null}
        </header>

        {!session.loading && !session.authenticated ? (
          <form className="formPanel loginPanel" onSubmit={login}>
            <h2>비밀번호 인증</h2>
            <p>{session.passwordConfigured ? "비밀번호를 입력하면 사용할 수 있습니다." : "PASSWORD 환경변수가 설정되지 않았습니다."}</p>
            <label>
              비밀번호
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            <button type="submit">로그인</button>
          </form>
        ) : null}

        {!session.loading && session.authenticated ? (
        <form className="editorGrid compact" onSubmit={submit}>
          <section className="formPanel">
            <div className="draftToolbar">
              <button type="button" className="ghost" onClick={saveDraft}>
                임시 저장
              </button>
              <a className="ghostLink" href="/api/auth/google/start">
                Google Sheets 연결
              </a>
              <label>
                임시 저장 불러오기
                <select value={selectedDraftId} onChange={loadDraft}>
                  <option value="">저장 시각 선택</option>
                  {drafts.map((draft) => (
                    <option key={draft.id} value={draft.id}>
                      {formatDraftTime(draft.savedAt)} {draft.form.topic ? `- ${draft.form.topic}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="fieldRow">
              <label>
                날짜
                <input name="date" type="date" value={form.date} onChange={updateField} required />
              </label>
              <label>
                등록자
                <input name="registrant" type="text" value={form.registrant} onChange={updateField} required />
              </label>
            </div>

            <label className="toggleRow">
              <span>
                Google Sheets 업데이트
                <small>끄면 Jira만 생성합니다.</small>
              </span>
              <input name="updateSheets" type="checkbox" checked={form.updateSheets} onChange={updateField} />
            </label>

            <label>
              미팅 주제
              <input name="topic" type="text" value={form.topic} onChange={updateField} placeholder="선택 입력" />
            </label>

            <label className="editorLabel">
              <span>회의록</span>
              <button type="button" className="iconButton" onClick={() => setPreview("minutes")} title="회의록 미리보기" aria-label="회의록 미리보기">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m16.5 16.5 4 4" />
                </svg>
              </button>
              <textarea
                name="minutes"
                className="markdownInput"
                value={form.minutes}
                onChange={updateField}
                placeholder="선택 입력, 마크다운 사용 가능"
              />
            </label>

            <label className="editorLabel">
              <span>다음 미팅까지의 계획</span>
              <button type="button" className="iconButton" onClick={() => setPreview("jira")} title="Jira 백로그 미리보기" aria-label="Jira 백로그 미리보기">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m16.5 16.5 4 4" />
                </svg>
              </button>
              <textarea
                name="plan"
                className="markdownInput planInput"
                value={form.plan}
                onChange={updateField}
                placeholder="# PPT 반영사항&#10;1. injection 대상 naming 재검토&#10;2. degradation 재분류"
                required
              />
            </label>

            <div className="actions">
              <button type="button" className="ghost" onClick={fillSample}>
                샘플 채우기
              </button>
              <button type="submit" disabled={submitting}>
                {submitting ? "등록 중" : "등록"}
              </button>
            </div>
          </section>
        </form>
        ) : null}
      </section>

      {preview ? (
        <PreviewDialog
          type={preview}
          minutesPreview={minutesPreview}
          backlogItems={backlogItems}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {toast ? <div className={`toast ${toast.type}`}>{toast.text}</div> : null}
    </main>
  );
}

function groupBacklogItems(items) {
  return items.reduce((groups, item) => {
    const match = item.match(/^\[([^\]]+)\]\s*(.*)$/);
    const title = match ? match[1] : "분류 없음";
    const text = match ? match[2] : item;
    const group = groups.find((entry) => entry.title === title);
    if (group) {
      group.items.push(text);
    } else {
      groups.push({ title, items: [text] });
    }
    return groups;
  }, []);
}

function PreviewDialog({ type, minutesPreview, backlogItems, onClose }) {
  const isJira = type === "jira";
  const groups = isJira ? groupBacklogItems(backlogItems) : [];

  return (
    <div className="modalBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="modalPanel" role="dialog" aria-modal="true" aria-label={isJira ? "Jira 백로그 미리보기" : "회의록 미리보기"} onMouseDown={(event) => event.stopPropagation()}>
        <header className="modalHeader">
          <div>
            <p>{isJira ? `${backlogItems.length}개 항목` : "Markdown Preview"}</p>
            <h2>{isJira ? "Jira 백로그 미리보기" : "회의록 미리보기"}</h2>
          </div>
          <button type="button" className="iconButton closeButton" onClick={onClose} title="닫기" aria-label="닫기">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        {isJira ? (
          <div className="jiraPreview">
            {groups.length ? (
              groups.map((group) => (
                <section className="jiraGroup" key={group.title}>
                  <h3>{group.title}</h3>
                  <ol>
                    {group.items.map((item, index) => (
                      <li key={`${group.title}-${item}`}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <p>{item}</p>
                      </li>
                    ))}
                  </ol>
                </section>
              ))
            ) : (
              <p className="empty modalEmpty"># 제목 아래에 1. 형식으로 계획을 입력하세요.</p>
            )}
          </div>
        ) : minutesPreview ? (
          <article className="markdownPreview modalMarkdown" dangerouslySetInnerHTML={{ __html: minutesPreview }} />
        ) : (
          <article className="markdownPreview modalMarkdown empty">회의록은 선택 입력입니다.</article>
        )}
      </section>
    </div>
  );
}
