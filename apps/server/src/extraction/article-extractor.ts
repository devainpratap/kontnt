import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { load } from "cheerio";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

const MIN_READABLE_TEXT_LENGTH = 500;
const MAX_REDIRECTS = 3;
const BLOCKED_URL_MESSAGE = "Blocked non-public URL";
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", () => undefined);

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    // Treat anything we cannot parse as unsafe.
    return true;
  }

  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 (incl. 0.0.0.0)
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // private 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16.0.0/12
  if (a === 192 && b === 168) return true; // private 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16 (incl. 169.254.169.254 metadata)
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  // IPv4-mapped addresses (::ffff:a.b.c.d) — evaluate the embedded IPv4.
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isIP(mapped) === 4) {
      return isPrivateIpv4(mapped);
    }
  }
  if (normalized === "::1") return true; // loopback
  if (normalized === "::") return true; // unspecified

  const firstGroup = normalized.split(":")[0];
  const firstWord = firstGroup ? Number.parseInt(firstGroup, 16) : 0;
  if (Number.isNaN(firstWord)) return true;
  const highByte = (firstWord >> 8) & 0xff;
  if (highByte === 0xfc || highByte === 0xfd) return true; // unique-local fc00::/7
  if (firstWord >= 0xfe80 && firstWord <= 0xfebf) return true; // link-local fe80::/10
  return false;
}

function isPrivateIp(ip: string, family: number): boolean {
  return family === 6 ? isPrivateIpv6(ip) : isPrivateIpv4(ip);
}

/**
 * Rejects URLs that could be used for SSRF: non-http(s) schemes, localhost /
 * *.localhost / *.local hosts, and any host that resolves to a loopback,
 * private, link-local, or unique-local address. Every resolved IP is checked
 * (DNS-rebinding defense) because a public hostname can point at a private IP.
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(BLOCKED_URL_MESSAGE);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(BLOCKED_URL_MESSAGE);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) {
    throw new Error(BLOCKED_URL_MESSAGE);
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error(BLOCKED_URL_MESSAGE);
  }

  const literalVersion = isIP(hostname);
  if (literalVersion !== 0) {
    if (isPrivateIp(hostname, literalVersion)) {
      throw new Error(BLOCKED_URL_MESSAGE);
    }
    return;
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error(BLOCKED_URL_MESSAGE);
  }

  if (addresses.length === 0) {
    throw new Error(BLOCKED_URL_MESSAGE);
  }
  for (const { address, family } of addresses) {
    if (isPrivateIp(address, family)) {
      throw new Error(BLOCKED_URL_MESSAGE);
    }
  }
}

export async function isPublicUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertPublicUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * fetch() that re-validates the target on every hop (and caps redirect count)
 * so a public URL cannot redirect us into a private/internal address.
 */
async function fetchPublic(url: string, init: RequestInit): Promise<Response> {
  let currentUrl = url;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicUrl(currentUrl);
    const response = await fetch(currentUrl, { ...init, redirect: "manual" });

    if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
      currentUrl = new URL(response.headers.get("location") as string, currentUrl).toString();
      continue;
    }

    return response;
  }

  throw new Error(`Too many redirects while fetching ${url}`);
}

type ExtractedArticle = {
  url: string;
  title: string;
  metaDescription: string;
  headings: string[];
  textContent: string;
  extractionSource: "local-readability" | "jina-reader";
};

function buildJinaReaderUrl(url: string) {
  return `https://r.jina.ai/${url}`;
}

function parseJinaReaderText(url: string, markdown: string): ExtractedArticle {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const titleLine = lines.find((line) => line.toLowerCase().startsWith("title:"));
  const title = titleLine?.replace(/^title:\s*/i, "").trim() ?? "";
  const headings = lines
    .filter((line) => /^#{1,3}\s+/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+/, "").trim())
    .filter(Boolean);
  const contentStart = lines.findIndex((line) => line.toLowerCase() === "markdown content:");
  const contentLines = contentStart >= 0 ? lines.slice(contentStart + 1) : lines;

  return {
    url,
    title,
    metaDescription: "",
    headings,
    textContent: contentLines.join("\n").trim(),
    extractionSource: "jina-reader"
  };
}

async function extractWithJinaReader(url: string) {
  // The original URL must already be validated by the caller before we reach
  // here — otherwise we would leak an internal URL to the third-party reader.
  const response = await fetchPublic(buildJinaReaderUrl(url), {
    signal: AbortSignal.timeout(20000),
    headers: {
      "user-agent": "SemanticSEOContentWorkflow/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Jina Reader failed for ${url}: ${response.status}`);
  }

  return parseJinaReaderText(url, await response.text());
}

async function extractWithLocalReadability(url: string): Promise<ExtractedArticle> {
  const response = await fetchPublic(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "user-agent": "SemanticSEOContentWorkflow/0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const html = await response.text();
  const $ = load(html);
  const document = new JSDOM(html, { url, virtualConsole }).window.document;
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const textContent = article?.textContent?.trim() ?? "";

  return {
    url,
    title: $("title").first().text().trim() || article?.title || "",
    metaDescription: $('meta[name="description"]').attr("content")?.trim() ?? "",
    headings: $("h1, h2, h3")
      .map((_, node) => $(node).text().trim())
      .get()
      .filter(Boolean),
    textContent,
    extractionSource: "local-readability"
  };
}

export async function extractArticleFromUrl(url: string) {
  // Reject non-public URLs before any fetch. This also gates the Jina fallback,
  // which would otherwise leak an internal URL to a third-party service.
  await assertPublicUrl(url);

  try {
    const article = await extractWithLocalReadability(url);
    if (article.textContent.length >= MIN_READABLE_TEXT_LENGTH) {
      return article;
    }
  } catch {
    // Fall through to the reader fallback below.
  }

  return extractWithJinaReader(url);
}
