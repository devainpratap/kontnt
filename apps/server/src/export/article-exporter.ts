import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

import { readTextFile, writeMarkdownFile } from "../jobs/files";
import { ApiError } from "../lib/api-error";

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function markdownToSimpleHtml(markdown: string) {
  const lines = markdown.split("\n");
  const htmlLines: string[] = [];
  let isListOpen = false;

  const closeList = () => {
    if (isListOpen) {
      htmlLines.push("</ul>");
      isListOpen = false;
    }
  };

  lines.forEach((line) => {
    if (line.startsWith("# ")) {
      closeList();
      htmlLines.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
      return;
    }

    if (line.startsWith("## ")) {
      closeList();
      htmlLines.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      return;
    }

    if (line.startsWith("### ")) {
      closeList();
      htmlLines.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
      return;
    }

    if (line.startsWith("- ")) {
      if (!isListOpen) {
        htmlLines.push("<ul>");
        isListOpen = true;
      }
      htmlLines.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      return;
    }

    if (!line.trim()) {
      closeList();
      htmlLines.push("");
      return;
    }

    closeList();
    htmlLines.push(`<p>${escapeHtml(line)}</p>`);
  });
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
    </style>
  </head>
  <body>
${htmlLines.join("\n")}
  </body>
</html>
`;
}

function markdownToDocxChildren(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line.trim() || (index > 0 && lines[index - 1]?.trim()))
    .map((line) => {
      if (line.startsWith("# ")) {
        return new Paragraph({
          text: line.slice(2),
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 240 }
        });
      }

      if (line.startsWith("## ")) {
        return new Paragraph({
          text: line.slice(3),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 320, after: 160 }
        });
      }

      if (line.startsWith("### ")) {
        return new Paragraph({
          text: line.slice(4),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 }
        });
      }

      if (line.startsWith("- ")) {
        return new Paragraph({
          children: [new TextRun(line.slice(2))],
          bullet: { level: 0 },
          spacing: { after: 80 }
        });
      }

      if (!line.trim()) {
        return new Paragraph({ text: "" });
      }

      return new Paragraph({
        children: [new TextRun(line)],
        spacing: { after: 160 }
      });
    });
}

async function writeDocxFile(path: string, markdown: string) {
  const doc = new Document({
    creator: "Semantic SEO Content Workflow",
    title: "Final Article",
    description: "Exported final optimized article",
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
