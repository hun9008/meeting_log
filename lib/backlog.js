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
