export function extractBacklogItems(markdown = "") {
  let heading = "";
  const items = [];

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

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

function splitNonEmptyLines(markdown = "") {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectMarkdownFormatIssues(markdown = "", label = "내용") {
  const issues = [];

  for (const [index, rawLine] of markdown.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    if (/^#+\S/.test(line)) {
      issues.push(`${label} ${index + 1}번째 줄: 제목은 \`# 제목\`처럼 # 뒤에 띄어쓰기를 넣어주세요.`);
    }

    if (/^\d+\)\s+/.test(line)) {
      issues.push(`${label} ${index + 1}번째 줄: 번호 목록은 \`1)\` 말고 \`1.\` 형식을 사용해주세요.`);
    }

    if (/^[-*][^\s]/.test(line)) {
      issues.push(`${label} ${index + 1}번째 줄: 목록은 \`- 내용\`처럼 기호 뒤에 띄어쓰기를 넣어주세요.`);
    }
  }

  return issues;
}

export function analyzeMinutesFormat(markdown = "") {
  const trimmed = markdown.trim();
  const issues = collectMarkdownFormatIssues(trimmed, "회의록");

  return {
    valid: issues.length === 0,
    issues,
    isEmpty: !trimmed
  };
}

export function analyzePlanFormat(markdown = "") {
  const trimmed = markdown.trim();
  const lines = splitNonEmptyLines(trimmed);
  const issues = collectMarkdownFormatIssues(trimmed, "다음 할 일");
  const itemCount = extractBacklogItems(trimmed).length;
  const hasHeading = lines.some((line) => /^#{1,6}\s+.+$/.test(line));

  if (!trimmed) {
    issues.push("다음 할 일은 필수입니다.");
  }

  if (trimmed && itemCount === 0) {
    issues.push("다음 할 일에는 최소 1개 이상의 번호 목록이 필요합니다. 예: `1. 작업 항목`");
  }

  return {
    valid: issues.length === 0,
    issues,
    itemCount,
    hasHeading
  };
}

export function formatPlanForSheet(markdown = "") {
  return formatPlanForSheetRichText(markdown).text;
}

export function formatPlanForSheetRichText(markdown = "") {
  const sections = [];
  let current = null;

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      current = { title: headingMatch[1].trim(), items: [] };
      sections.push(current);
      continue;
    }

    const itemMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (itemMatch) {
      if (!current) {
        current = { title: "", items: [] };
        sections.push(current);
      }
      current.items.push(itemMatch[1].trim());
    }
  }

  const boldRanges = [];
  let text = "";
  let offset = 0;

  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0 && text) {
      text += "\n\n";
      offset += 2;
    }

    if (section.title) {
      text += section.title;
      boldRanges.push({ start: offset, end: offset + section.title.length });
      offset += section.title.length;
    }

    section.items.forEach((item) => {
      if (text) {
        text += "\n";
        offset += 1;
      }
      text += item;
      offset += item.length;
    });
  });

  return {
    text,
    boldRanges
  };
}

export function formatMarkdownForSheetRichText(markdown = "") {
  const lines = [];
  const boldRanges = [];
  let text = "";
  let offset = 0;

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/) || trimmed.match(/^\d+\.\s+(.+)$/);
    const value = headingMatch ? headingMatch[1].trim() : listMatch ? listMatch[1].trim() : trimmed;
    const isHeading = Boolean(headingMatch);

    if (isHeading && lines.length > 0) {
      text += "\n\n";
      offset += 2;
    } else if (text) {
      text += "\n";
      offset += 1;
    }

    text += value;
    if (isHeading) {
      boldRanges.push({ start: offset, end: offset + value.length });
    }
    offset += value.length;
    lines.push(value);
  }

  return {
    text,
    boldRanges
  };
}
