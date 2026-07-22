import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";

import { readTextFile, writeMarkdownFile } from "../jobs/files";
import { ApiError } from "../lib/api-error";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// -------------------------------------------------------------------------
// Inline tokenizer (shared by the HTML and DOCX emitters)
// -------------------------------------------------------------------------

type InlineToken =
  | { type: "text"; text: string; bold?: boolean; italic?: boolean; code?: boolean }
  | { type: "link"; text: string; url: string; bold?: boolean; italic?: boolean };

type ColumnAlignment = "left" | "center" | "right" | null;

/**
 * Restrict link URLs to a safe subset to avoid `javascript:` and other
 * script-bearing schemes. Absolute http(s)/mailto and relative URLs pass;
 * anything else is dropped (rendered as plain text by the caller).
 */
function sanitizeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  // Relative URLs (no scheme) or fragment/anchor links are allowed.
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null; // some other scheme -> reject
  return trimmed; // relative path / anchor
}

/**
 * Parse a single line of inline markdown into a flat list of tokens.
 * Handles: `` `code` ``, `[text](url)`, `**bold**`/`__bold__`,
 * `*italic*`/`_italic_`. Formatting is not deeply nested — a link's own
 * text is emitted as plain text (docx hyperlinks carry their own styling).
 */
function tokenizeInline(input: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let i = 0;
  let buffer = "";

  const flush = () => {
    if (buffer) {
      tokens.push({ type: "text", text: buffer });
      buffer = "";
    }
  };

  while (i < input.length) {
    const rest = input.slice(i);

    // Inline code: `code`
    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      flush();
      tokens.push({ type: "text", text: code[1], code: true });
      i += code[0].length;
      continue;
    }

    // Link: [text](url)
    const link = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(rest);
    if (link) {
      const url = sanitizeUrl(link[2]);
      if (url) {
        flush();
        tokens.push({ type: "link", text: link[1], url });
        i += link[0].length;
        continue;
      }
    }

    // Bold: **text** or __text__
    const bold = /^(\*\*|__)([\s\S]+?)\1/.exec(rest);
    if (bold) {
      flush();
      for (const inner of tokenizeInline(bold[2])) {
        if (inner.type === "text") {
          tokens.push({ ...inner, bold: true });
        } else {
          tokens.push({ ...inner, bold: true });
        }
      }
      i += bold[0].length;
      continue;
    }

    // Italic: *text* or _text_
    const italic = /^(\*|_)(?!\s)([\s\S]+?)(?<!\s)\1/.exec(rest);
    if (italic) {
      flush();
      for (const inner of tokenizeInline(italic[2])) {
        tokens.push({ ...inner, italic: true });
      }
      i += italic[0].length;
      continue;
    }

    buffer += input[i];
    i += 1;
  }

  flush();
  return tokens;
}

// -------------------------------------------------------------------------
// HTML inline emitter
// -------------------------------------------------------------------------

function inlineTokensToHtml(tokens: InlineToken[]): string {
  return tokens
    .map((token) => {
      if (token.type === "link") {
        let inner = escapeHtml(token.text || token.url);
        if (token.bold) inner = `<strong>${inner}</strong>`;
        if (token.italic) inner = `<em>${inner}</em>`;
        return `<a href="${escapeHtml(token.url)}">${inner}</a>`;
      }
      let html = escapeHtml(token.text);
      if (token.code) html = `<code>${html}</code>`;
      if (token.bold) html = `<strong>${html}</strong>`;
      if (token.italic) html = `<em>${html}</em>`;
      return html;
    })
    .join("");
}

function renderInlineHtml(text: string): string {
  return inlineTokensToHtml(tokenizeInline(text));
}

// -------------------------------------------------------------------------
// DOCX inline emitter
// -------------------------------------------------------------------------

function inlineTokensToDocxRuns(
  tokens: InlineToken[],
  forceBold = false
): (TextRun | ExternalHyperlink)[] {
  return tokens.map((token) => {
    if (token.type === "link") {
      return new ExternalHyperlink({
        link: token.url,
        children: [
          new TextRun({
            text: token.text || token.url,
            bold: token.bold || forceBold || undefined,
            italics: token.italic,
            style: "Hyperlink"
          })
        ]
      });
    }
    return new TextRun({
      text: token.text,
      bold: token.bold || forceBold || undefined,
      italics: token.italic,
      font: token.code ? "Courier New" : undefined
    });
  });
}

function renderInlineDocxRuns(text: string, forceBold = false): (TextRun | ExternalHyperlink)[] {
  const runs = inlineTokensToDocxRuns(tokenizeInline(text), forceBold);
  return runs.length > 0 ? runs : [new TextRun({ text: "", bold: forceBold || undefined })];
}

// -------------------------------------------------------------------------
// GFM table parsing
// -------------------------------------------------------------------------

function isTableDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  const cells = splitTableRow(trimmed);
  if (cells.length === 0) return false;
  return cells.every((cell) => /^:?-+:?$/.test(cell.trim()));
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  // Split on unescaped pipes.
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function looksLikeTableRow(line: string): boolean {
  return line.trim().includes("|");
}

function parseAlignments(delimiterCells: string[]): ColumnAlignment[] {
  return delimiterCells.map((cell) => {
    const trimmed = cell.trim();
    const left = trimmed.startsWith(":");
    const right = trimmed.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

type ParsedTable = {
  header: string[];
  alignments: ColumnAlignment[];
  rows: string[][];
};

/**
 * Attempt to parse a GFM pipe table starting at `startIndex`.
 * Returns the parsed table plus the index of the last consumed line,
 * or null if the lines at `startIndex` are not a valid table header.
 */
function tryParseTable(lines: string[], startIndex: number): { table: ParsedTable; endIndex: number } | null {
  const headerLine = lines[startIndex];
  const delimiterLine = lines[startIndex + 1];
  if (!headerLine || !delimiterLine) return null;
  if (!looksLikeTableRow(headerLine)) return null;
  if (!isTableDelimiterRow(delimiterLine)) return null;

  const header = splitTableRow(headerLine);
  const alignments = parseAlignments(splitTableRow(delimiterLine));
  const rows: string[][] = [];

  let index = startIndex + 2;
  while (index < lines.length && looksLikeTableRow(lines[index]) && lines[index].trim()) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  return { table: { header, alignments, rows }, endIndex: index - 1 };
}

// -------------------------------------------------------------------------
// HTML conversion
// -------------------------------------------------------------------------

function tableToHtml(table: ParsedTable): string {
  const alignAttr = (col: number) => {
    const align = table.alignments[col];
    return align ? ` style="text-align: ${align}"` : "";
  };

  const headCells = table.header
    .map((cell, col) => `<th${alignAttr(col)}>${renderInlineHtml(cell)}</th>`)
    .join("");

  const bodyRows = table.rows
    .map((row) => {
      const cells = row
        .map((cell, col) => `<td${alignAttr(col)}>${renderInlineHtml(cell)}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");

  return `<table>
<thead><tr>${headCells}</tr></thead>
<tbody>
${bodyRows}
</tbody>
</table>`;
}

function markdownToSimpleHtml(markdown: string) {
  const lines = markdown.split("\n");
  const htmlLines: string[] = [];
  let isListOpen = false;
  let isOrderedListOpen = false;

  const closeList = () => {
    if (isListOpen) {
      htmlLines.push("</ul>");
      isListOpen = false;
    }
    if (isOrderedListOpen) {
      htmlLines.push("</ol>");
      isOrderedListOpen = false;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Tables
    if (looksLikeTableRow(line) && lines[i + 1] !== undefined && isTableDelimiterRow(lines[i + 1])) {
      const parsed = tryParseTable(lines, i);
      if (parsed) {
        closeList();
        htmlLines.push(tableToHtml(parsed.table));
        i = parsed.endIndex;
        continue;
      }
    }

    if (line.startsWith("# ")) {
      closeList();
      htmlLines.push(`<h1>${renderInlineHtml(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith("## ")) {
      closeList();
      htmlLines.push(`<h2>${renderInlineHtml(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith("### ")) {
      closeList();
      htmlLines.push(`<h3>${renderInlineHtml(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith("- ")) {
      if (isOrderedListOpen) {
        htmlLines.push("</ol>");
        isOrderedListOpen = false;
      }
      if (!isListOpen) {
        htmlLines.push("<ul>");
        isListOpen = true;
      }
      htmlLines.push(`<li>${renderInlineHtml(line.slice(2))}</li>`);
      continue;
    }

    const orderedMatch = /^(\d+)\.\s+(.*)$/.exec(line);
    if (orderedMatch) {
      if (isListOpen) {
        htmlLines.push("</ul>");
        isListOpen = false;
      }
      if (!isOrderedListOpen) {
        htmlLines.push("<ol>");
        isOrderedListOpen = true;
      }
      htmlLines.push(`<li>${renderInlineHtml(orderedMatch[2])}</li>`);
      continue;
    }

    if (!line.trim()) {
      closeList();
      htmlLines.push("");
      continue;
    }

    closeList();
    htmlLines.push(`<p>${renderInlineHtml(line)}</p>`);
  }
  closeList();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Final Article</title>
    <style>
      body { font-family: ui-serif, Georgia, serif; line-height: 1.7; max-width: 760px; margin: 48px auto; padding: 0 24px; color: #211a14; }
      h1, h2, h3 { font-family: ui-sans-serif, system-ui, sans-serif; line-height: 1.2; }
      h1 { font-size: 2.2rem; }
      h2 { margin-top: 2rem; }
      li { margin: 0.35rem 0; }
      table { border-collapse: collapse; width: 100%; margin: 1.5rem 0; font-family: ui-sans-serif, system-ui, sans-serif; font-size: 0.95rem; }
      th, td { border: 1px solid #d8ccbf; padding: 0.5rem 0.75rem; text-align: left; vertical-align: top; }
      th { background: #f4ede4; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f4ede4; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.9em; }
    </style>
  </head>
  <body>
${htmlLines.join("\n")}
  </body>
</html>
`;
}

// -------------------------------------------------------------------------
// DOCX conversion
// -------------------------------------------------------------------------

function docxAlignment(align: ColumnAlignment) {
  if (align === "center") return AlignmentType.CENTER;
  if (align === "right") return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

function tableToDocx(table: ParsedTable): Table {
  const columnCount = Math.max(
    table.header.length,
    ...table.rows.map((row) => row.length)
  );

  const makeCell = (text: string, col: number, isHeader: boolean) =>
    new TableCell({
      children: [
        new Paragraph({
          children: renderInlineDocxRuns(text, isHeader),
          alignment: docxAlignment(table.alignments[col] ?? null)
        })
      ]
    });

  const headerCells = Array.from({ length: columnCount }, (_, col) =>
    makeCell(table.header[col] ?? "", col, true)
  );

  const headerRow = new TableRow({ tableHeader: true, children: headerCells });

  const bodyRows = table.rows.map((row) => {
    const cells = Array.from({ length: columnCount }, (_, col) =>
      makeCell(row[col] ?? "", col, false)
    );
    return new TableRow({ children: cells });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows]
  });
}

function markdownToDocxChildren(markdown: string): (Paragraph | Table)[] {
  const rawLines = markdown.split("\n").map((line) => line.trimEnd());
  const children: (Paragraph | Table)[] = [];

  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];

    // Tables
    if (looksLikeTableRow(line) && rawLines[i + 1] !== undefined && isTableDelimiterRow(rawLines[i + 1])) {
      const parsed = tryParseTable(rawLines, i);
      if (parsed) {
        children.push(tableToDocx(parsed.table));
        i = parsed.endIndex;
        continue;
      }
    }

    if (line.startsWith("# ")) {
      children.push(
        new Paragraph({
          children: renderInlineDocxRuns(line.slice(2)),
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 240 }
        })
      );
      continue;
    }

    if (line.startsWith("## ")) {
      children.push(
        new Paragraph({
          children: renderInlineDocxRuns(line.slice(3)),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 320, after: 160 }
        })
      );
      continue;
    }

    if (line.startsWith("### ")) {
      children.push(
        new Paragraph({
          children: renderInlineDocxRuns(line.slice(4)),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 }
        })
      );
      continue;
    }

    if (line.startsWith("- ")) {
      children.push(
        new Paragraph({
          children: renderInlineDocxRuns(line.slice(2)),
          bullet: { level: 0 },
          spacing: { after: 80 }
        })
      );
      continue;
    }

    const orderedMatch = /^(\d+)\.\s+(.*)$/.exec(line);
    if (orderedMatch) {
      children.push(
        new Paragraph({
          children: renderInlineDocxRuns(orderedMatch[2]),
          numbering: { reference: "article-ordered-list", level: 0 },
          spacing: { after: 80 }
        })
      );
      continue;
    }

    if (!line.trim()) {
      // Collapse runs of blank lines: only emit an empty paragraph when the
      // previous emitted child was not already a blank spacer.
      const prev = rawLines[i - 1];
      if (i > 0 && prev?.trim()) {
        children.push(new Paragraph({ text: "" }));
      }
      continue;
    }

    children.push(
      new Paragraph({
        children: renderInlineDocxRuns(line),
        spacing: { after: 160 }
      })
    );
  }

  return children;
}

async function writeDocxFile(path: string, markdown: string) {
  const doc = new Document({
    creator: "Semantic SEO Content Workflow",
    title: "Final Article",
    description: "Exported final optimized article",
    numbering: {
      config: [
        {
          reference: "article-ordered-list",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.LEFT
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {},
        children: markdownToDocxChildren(markdown)
      }
    ]
  });
  const buffer = await Packer.toBuffer(doc);
  await writeFile(path, buffer);
}

export async function exportFinalArticle(options: {
  sourcePath: string;
  markdownExportPath: string;
  htmlExportPath: string;
  docxExportPath: string;
  format: "markdown" | "html" | "docx";
}) {
  const source = await readTextFile(options.sourcePath);

  if (!source) {
    throw new ApiError("Run final optimization before exporting the article.", 400, "FINAL_ARTICLE_REQUIRED");
  }

  if (options.format === "markdown") {
    await mkdir(dirname(options.markdownExportPath), { recursive: true });
    await writeMarkdownFile(options.markdownExportPath, source);
    return {
      format: "markdown" as const,
      exportPath: options.markdownExportPath,
      sourcePath: options.sourcePath,
      message: "Markdown export created."
    };
  }

  if (options.format === "docx") {
    await mkdir(dirname(options.docxExportPath), { recursive: true });
    await writeDocxFile(options.docxExportPath, source);
    return {
      format: "docx" as const,
      exportPath: options.docxExportPath,
      sourcePath: options.sourcePath,
      message: "DOCX export created."
    };
  }

  await mkdir(dirname(options.htmlExportPath), { recursive: true });
  await writeMarkdownFile(options.htmlExportPath, markdownToSimpleHtml(source));
  return {
    format: "html" as const,
    exportPath: options.htmlExportPath,
    sourcePath: options.sourcePath,
    message: "HTML export created."
  };
}

// Exported for unit testing of the conversion internals.
export const __test__ = {
  markdownToSimpleHtml,
  markdownToDocxChildren,
  tokenizeInline,
  renderInlineHtml
};
