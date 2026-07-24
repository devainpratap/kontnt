/**
 * Minimal Markdown -> HTML for the report email body.
 *
 * Deliberately tiny and dependency-free: the input is always our own Claude
 * report in a known shape (headings, bold, bullet lists, GFM tables,
 * paragraphs), not arbitrary Markdown. Everything is HTML-escaped first, so no
 * content from the model can inject markup into the email.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline: **bold** only. Applied after escaping, so the ** are literal markers. */
function inline(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function markdownToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let listBuffer: string[] = [];
  let tableBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length === 0) return;
    out.push(`<ul style="margin:0 0 14px 18px;padding:0">${listBuffer
      .map((item) => `<li style="margin:2px 0">${inline(item.replace(/^[-*]\s+/, ""))}</li>`)
      .join("")}</ul>`);
    listBuffer = [];
  };

  const flushTable = () => {
    if (tableBuffer.length === 0) return;
    const rows = tableBuffer
      .filter((line) => !/^\|[\s:|-]+\|$/.test(line))
      .map((line) =>
        line
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim())
      );
    const [header, ...body] = rows;
    const th = (header ?? [])
      .map((cell) => `<th align="left" style="padding:6px 10px;border-bottom:2px solid #e2e8f0;font-size:12px;color:#64748b">${inline(cell)}</th>`)
      .join("");
    const trs = body
      .map(
        (row) =>
          `<tr>${row
            .map((cell) => `<td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-size:13px">${inline(cell)}</td>`)
            .join("")}</tr>`
      )
      .join("");
    out.push(
      `<table style="border-collapse:collapse;width:100%;margin:0 0 16px 0"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`
    );
    tableBuffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim().startsWith("|")) {
      flushList();
      tableBuffer.push(line.trim());
      continue;
    }
    flushTable();

    if (/^[-*]\s+/.test(line.trim())) {
      listBuffer.push(line.trim());
      continue;
    }
    flushList();

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const size = level <= 1 ? 22 : level === 2 ? 17 : 14;
      const margin = level <= 1 ? "18px 0 10px" : "16px 0 8px";
      out.push(`<h${level} style="font-size:${size}px;margin:${margin};color:#0f172a">${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (line.trim() === "") {
      continue;
    }

    out.push(`<p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#334155">${inline(line)}</p>`);
  }

  flushList();
  flushTable();
  return out.join("\n");
}
