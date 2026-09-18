import { basename, extname } from "node:path";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// Heavy binary/format parsers (pdf-parse pulls @napi-rs/canvas which needs
// DOMMatrix/native bindings) must stay lazy: text-only ingestion (remember_note,
// ingest text/url) should never touch them at import time. Otherwise merely
// importing normalizer.js crashes restricted runtimes with
// "DOMMatrix is not defined" even when no PDF/DOCX/XLSX is processed.
let _pdfParseCtor = null;
let _mammoth = null;
let _xlsx = null;

async function getPdfParseCtor() {
  if (!_pdfParseCtor) {
    const mod = await import("pdf-parse");
    _pdfParseCtor = mod.PDFParse || mod.default?.PDFParse || mod.default;
  }
  return _pdfParseCtor;
}

async function getMammoth() {
  if (!_mammoth) {
    const mod = await import("mammoth");
    _mammoth = mod.default || mod;
  }
  return _mammoth;
}

async function getXlsx() {
  if (!_xlsx) {
    const mod = await import("xlsx");
    _xlsx = mod.default && mod.default.read ? mod.default : mod;
  }
  return _xlsx;
}

export function cleanHtml(html) {
  if (!html) return "";

  let cleaned = html.replace(/<(script|style|nav|header|footer|svg|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");

  cleaned = cleaned.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n");
  cleaned = cleaned.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
  cleaned = cleaned.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
  cleaned = cleaned.replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, "\n#### $1\n");

  cleaned = cleaned.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n- $1");
  cleaned = cleaned.replace(/<(p|div|br)[^>]*>/gi, "\n");

  cleaned = cleaned.replace(/<[^>]+>/g, "");

  cleaned = cleaned
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, "\n\n").trim();
  return cleaned;
}

export function validateUrlForSsrf(urlStr) {
  if (typeof urlStr !== "string" || !urlStr.trim()) {
    throw new Error(`Unsupported URL for ingestion: '${urlStr}'. Only http/https URLs are supported.`);
  }
  let parsed;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    throw new Error(`Invalid URL format for ingestion: '${urlStr}'`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme '${parsed.protocol}'. Only http/https are allowed.`);
  }

  const hostname = normalizeHostname(parsed.hostname);

  if (isBlockedHost(hostname)) {
    throw new Error(`Ingestion blocked: URL '${urlStr}' targets a private/local IP address or metadata service.`);
  }

  return parsed;
}

// URL.hostname keeps the brackets for IPv6 literals ("[::1]"), which broke the
// plain string comparisons and allowed http://[::1]/ and IPv4-mapped forms through.
export function normalizeHostname(rawHostname) {
  let host = String(rawHostname || "").toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

function isPrivateIPv4(host) {
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split(".").map(Number);
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIPv6(host) {
  if (isIP(host) !== 6) return false;
  // IPv4-mapped / IPv4-compatible forms: ::ffff:127.0.0.1 and ::ffff:7f00:1
  const mapped = extractMappedIPv4(host);
  if (mapped) return isPrivateIPv4(mapped);

  if (host === "::" || host === "::1") return true;
  if (/^fe[89ab]/.test(host)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(host)) return true;    // fc00::/7 unique-local
  if (/^ff/.test(host)) return true;       // ff00::/8 multicast
  if (/^0{0,4}:/.test(host) && !host.startsWith("::ffff:")) return true; // ::/8
  return false;
}

function extractMappedIPv4(host) {
  const dotted = host.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

export function isBlockedHost(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "metadata.google.internal" || host === "metadata") return true;
  if (isPrivateIPv4(host)) return true;
  if (isPrivateIPv6(host)) return true;
  return false;
}

// Defence against DNS rebinding: resolve the hostname and re-check the actual
// address before the request is issued.
export async function assertResolvedHostAllowed(hostname) {
  const host = normalizeHostname(hostname);
  if (isIP(host)) return;
  let addresses;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return; // fetch() will surface the resolution error itself
  }
  for (const { address } of addresses) {
    if (isBlockedHost(address)) {
      throw new Error(
        `Ingestion blocked: host '${host}' resolves to a private/local address (${address}).`
      );
    }
  }
}

// Fetch a web page and convert it to Markdown/text. Used by the 'url' ingestion type
// so the RAG store gets the page CONTENT, not just the URL string.
export async function fetchUrlContent(url) {
  const parsed = validateUrlForSsrf(url);
  await assertResolvedHostAllowed(parsed.hostname);
  let currentUrl = parsed.toString();

  const fetchOnce = async (targetUrl) => {
    try {
      return await fetch(targetUrl, {
        headers: {
          "User-Agent": "memory-agent-rag/1.0",
          Accept: "text/html,application/xhtml+xml,application/json,text/plain,*/*",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new Error(`Failed to fetch URL '${url}': ${err.message}`);
    }
  };

  // Follow up to 3 redirect hops manually, re-validating each target against SSRF rules.
  let res = await fetchOnce(currentUrl);
  for (let hop = 0; hop < 3 && res.status >= 300 && res.status < 400; hop++) {
    const location = res.headers.get("location");
    if (!location) break;
    let redirectUrl;
    try {
      redirectUrl = new URL(location, currentUrl);
    } catch {
      throw new Error(`URL '${url}' redirected to an invalid location`);
    }
    validateUrlForSsrf(redirectUrl.toString());
    await assertResolvedHostAllowed(redirectUrl.hostname);
    currentUrl = redirectUrl.toString();
    res = await fetchOnce(currentUrl);
  }

  if (!res.ok) {
    throw new Error(`Failed to fetch URL '${url}': HTTP ${res.status} ${res.statusText}`);
  }
  const raw = await res.text();
  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const looksLikeHtml = /<html|<body|<div|<article|<main|<!doctype/i.test(raw.slice(0, 4096));
  let markdown;
  if (contentType.includes("html") || looksLikeHtml) {
    markdown = cleanHtml(raw);
  } else if (contentType.includes("json") || /^[\[{]/.test(raw.trim())) {
    try {
      markdown = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      markdown = raw.trim();
    }
  } else {
    markdown = raw.trim();
  }
  const titleMatch = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : null;
  return { markdown, title: title || null, finalUrl: res.url || url.trim() };
}

export function extractTitle(markdown, fallbackName = "Untitled Document") {
  const h1Match = markdown.match(/^#\s+(.+)$/m);
  if (h1Match && h1Match[1].trim()) {
    return h1Match[1].trim();
  }
  return fallbackName;
}

export function stripMarkdownBadgesAndNoise(text) {
  if (!text) return "";
  let cleaned = text;

  // 1. Remove markdown link-wrapped badges: [![alt](image_url)](link_url)
  cleaned = cleaned.replace(/\[\s*!\[[^\]]*\]\([^)]+\)\s*\]\([^)]+\)/g, "");

  // 2. Remove standalone markdown image badges: ![alt](https://img.shields.io/...) or badge URLs
  cleaned = cleaned.replace(/!\[[^\]]*\]\([^)]*(?:shields\.io|badge|actions\/workflows|codecov|travis-ci)[^)]*\)/gi, "");

  // 3. Remove raw HTML img badge tags
  cleaned = cleaned.replace(/<img[^>]*(?:shields\.io|badge|workflows|badge\.svg)[^>]*>/gi, "");

  // 4. Remove empty HTML anchor containers often surrounding badges
  cleaned = cleaned.replace(/<a[^>]*>\s*<\/a>/gi, "");

  // 5. Normalize excessive blank lines
  cleaned = cleaned.replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return cleaned;
}

export function humanizeHeader(name) {
  const s = String(name ?? "").trim();
  if (!s) return s;
  return s.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}

function headerKey(name) {
  return String(name ?? "").toLowerCase().replace(/[\s_\-]+/g, "");
}

// Tiny search-oriented verbalization for table cells (no dictionaries to
// maintain): boolean-ish values get yes/no aliases, stock-like columns get
// in/out-of-stock aliases in both languages so queries like
// "product out of stock" hit "InStock: false".
export function verbalizeCell(header, value) {
  const v = String(value ?? "").trim().toLowerCase();
  const hk = headerKey(header);
  const isStock = /(instock|stock|avail|наличи)/.test(hk);
  const truthy = ["true", "yes", "y", "да", "в наличии", "in stock"].includes(v);
  const falsy = ["false", "no", "n", "нет", "не в наличии", "out of stock"].includes(v);
  if (isStock) {
    if (falsy) return " (out of stock / нет в наличии)";
    if (truthy) return " (in stock / в наличии)";
    return null;
  }
  if (truthy) return " (yes / да)";
  if (falsy) return " (no / нет)";
  return null;
}

export async function parseSpreadsheet(content, fileName, isCsv = false) {
  const xlsxLib = await getXlsx();
  const options = isCsv && (typeof content === "string") ? { type: "string" } : { type: "buffer" };
  const workbook = xlsxLib.read(content, options);
  let markdownParts = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    // Convert to JSON 2D array
    const rows = xlsxLib.utils.sheet_to_json(sheet, { header: 1 });
    if (rows.length === 0) continue;

    markdownParts.push(`## Sheet: ${sheetName}\n`);

    // Create Markdown Table representation
    const normalizedRows = rows.map(r => (Array.isArray(r) ? r : []).map(cell => (cell === undefined || cell === null) ? "" : String(cell)));
    const maxCols = Math.max(...normalizedRows.map(r => r.length), 0);
    if (maxCols === 0) continue;

    // Pad all rows to maxCols
    for (const r of normalizedRows) {
      while (r.length < maxCols) r.push("");
    }

    // Header
    const headers = normalizedRows[0];
    markdownParts.push(`| ${headers.join(" | ")} |`);
    markdownParts.push(`| ${headers.map(() => "---").join(" | ")} |`);

    // Data rows
    for (let i = 1; i < normalizedRows.length; i++) {
      markdownParts.push(`| ${normalizedRows[i].join(" | ")} |`);
    }

    markdownParts.push("\n### Searchable Records\n");
    // Row-by-row key-value representation for chunking/semantic search
    for (let i = 1; i < normalizedRows.length; i++) {
      const row = normalizedRows[i];
      // Skip completely empty rows
      if (row.every(cell => cell.trim() === "")) continue;

      markdownParts.push(`Record ${i} from sheet ${sheetName}:`);
      for (let j = 0; j < maxCols; j++) {
        const headerName = humanizeHeader(headers[j]) || `Column_${j + 1}`;
        const val = row[j]?.trim() || "";
        markdownParts.push(`- ${headerName}: ${val}${verbalizeCell(headers[j], row[j]) || ""}`);
      }
      markdownParts.push("");
    }
  }

  return markdownParts.join("\n");
}

export async function normalizeContent({ content, type = "text", path = null, title = null }) {
  let markdown = "";
  let docTitle = title;
  const fileName = path ? basename(path) : "document";

  if (type === "url" || (typeof content === "string" && /<html|<body|<div/i.test(content))) {
    markdown = cleanHtml(content);
    docTitle = title || extractTitle(markdown, fileName);
  } else if (type === "file" && path) {
    const ext = extname(path).toLowerCase();
    const codeLangs = {
      ".js": "javascript",
      ".ts": "typescript",
      ".py": "python",
      ".go": "go",
      ".rs": "rust",
      ".cpp": "cpp",
      ".h": "cpp",
      ".hpp": "cpp",
      ".cc": "cpp",
      ".cxx": "cpp",
      ".java": "java",
      ".kt": "kotlin",
      ".cs": "csharp",
      ".php": "php",
      ".rb": "ruby",
      ".json": "json",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".css": "css",
      ".html": "html",
    };

    if (ext === ".pdf") {
      try {
        const pdfBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
        const PDFParseCtor = await getPdfParseCtor();
        const parser = new PDFParseCtor({ data: pdfBuffer });
        const result = await parser.getText();
        markdown = result.text || "";
        docTitle = title || fileName;
      } catch (err) {
        throw new Error(`Failed to parse PDF file '${fileName}': ${err.message}`);
      }
    } else if (ext === ".docx") {
      try {
        const docxBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
        const mammothLib = await getMammoth();
        const result = await mammothLib.convertToMarkdown({ buffer: docxBuffer });
        // Mammoth escapes markdown specials (docx\-decision, 2026\-10\-01, \.)
        // which breaks exact-token search in RAG. For retrieval we want plain
        // text, so unescape the standard set.
        markdown = String(result.value || "").replace(/\\([\\.\-*_+#!(){}\[\]])/g, "$1");
        docTitle = title || fileName;
      } catch (err) {
        throw new Error(`Failed to parse DOCX file '${fileName}': ${err.message}`);
      }
    } else if (ext === ".xlsx" || ext === ".xls" || ext === ".csv") {
      try {
        markdown = await parseSpreadsheet(content, fileName, ext === ".csv");
        docTitle = title || fileName;
      } catch (err) {
        throw new Error(`Failed to parse spreadsheet file '${fileName}': ${err.message}`);
      }
    } else if (codeLangs[ext]) {
      const textContent = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
      markdown = `# ${fileName}\n\n\`\`\`${codeLangs[ext]}\n${textContent.trim()}\n\`\`\``;
      docTitle = title || fileName;
    } else {
      const textContent = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
      markdown = textContent.trim();
      docTitle = title || extractTitle(markdown, fileName);
    }
  } else {
    const textContent = Buffer.isBuffer(content) ? content.toString("utf8") : String(content);
    markdown = textContent.trim();
    docTitle = title || extractTitle(markdown, "Direct Note");
  }

  // Apply noise and badge stripping to all developer documentation
  markdown = stripMarkdownBadgesAndNoise(markdown);

  return {
    markdown,
    title: docTitle,
    metadata: {
      source_type: type,
      original_path: path || null,
      char_count: markdown.length,
    },
  };
}
