/**
 * Bulk keyword import.
 *
 * You will never hand-enter 800 keywords, so paste and CSV are the primary
 * entry path. The parser is deliberately forgiving about shape (comma, tab, or
 * bare lines; optional header; quoted fields) and strict about the result:
 * anything it cannot read is returned as a rejected line with a reason rather
 * than silently dropped, because a keyword that vanishes on import is a
 * keyword you think you are tracking and are not.
 */

export type ParsedKeywordLine = {
  phrase: string;
  targetUrl: string | null;
};

export type ParseResult = {
  rows: ParsedKeywordLine[];
  invalid: Array<{ line: string; reason: string }>;
};

const MAX_PHRASE_LENGTH = 200;
const HEADER_TOKENS = new Set(["keyword", "keywords", "query", "phrase", "term", "search term"]);

/** Split one CSV line, honouring double-quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      // A doubled quote inside a quoted field is a literal quote.
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && (char === "," || char === "\t")) {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields.map((field) => field.trim());
}

function isProbablyHeader(fields: string[]): boolean {
  return HEADER_TOKENS.has(fields[0]?.toLowerCase() ?? "");
}

function normalisePhrase(value: string): string {
  // Collapse internal whitespace so "gps   tracker" and "gps tracker" are one
  // keyword rather than two rows that scrape twice and report separately.
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isValidTargetUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parse pasted text into keyword rows.
 *
 * Accepted per line: `keyword`, `keyword, https://target`, or a CSV/TSV row
 * whose first column is the keyword and whose second (if URL-shaped) is the
 * target. Duplicates within the paste are collapsed, keeping the first
 * occurrence — re-importing a list must not double the scrape volume.
 */
export function parseKeywordImport(raw: string): ParseResult {
  const rows: ParsedKeywordLine[] = [];
  const invalid: Array<{ line: string; reason: string }> = [];
  const seen = new Set<string>();

  const lines = raw.split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const fields = splitCsvLine(line);

    if (index === 0 && isProbablyHeader(fields)) {
      continue;
    }

    const phrase = normalisePhrase(fields[0] ?? "");

    if (!phrase) {
      invalid.push({ line, reason: "No keyword in the first column." });
      continue;
    }

    if (phrase.length > MAX_PHRASE_LENGTH) {
      invalid.push({ line, reason: `Longer than ${MAX_PHRASE_LENGTH} characters.` });
      continue;
    }

    // A pasted URL in the keyword column is almost always a column mix-up, and
    // tracking it as a search term would waste checks on a query nobody types.
    if (/^https?:\/\//i.test(phrase)) {
      invalid.push({ line, reason: "Looks like a URL, not a search term." });
      continue;
    }

    if (seen.has(phrase)) {
      continue;
    }
    seen.add(phrase);

    const candidateUrl = fields[1]?.trim() ?? "";
    const targetUrl = candidateUrl && isValidTargetUrl(candidateUrl) ? candidateUrl : null;

    if (candidateUrl && !targetUrl) {
      // Keep the keyword; just note that the target could not be used.
      invalid.push({ line, reason: `Ignored target "${candidateUrl}" — not a valid http(s) URL.` });
    }

    rows.push({ phrase, targetUrl });
  }

  return { rows, invalid };
}
