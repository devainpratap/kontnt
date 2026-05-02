export function sanitizeGeneratedMarkdown(markdown: string) {
  return markdown
    .replace(/\s*[\u2013\u2014]\s*/g, " - ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +\n/g, "\n")
    .trimEnd();
}
