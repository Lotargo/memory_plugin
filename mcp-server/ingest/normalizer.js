import { basename, extname } from "node:path";

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

export function normalizeContent({ content, type = "text", path = null, title = null }) {
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
      ".json": "json",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".css": "css",
      ".html": "html",
    };

    if (codeLangs[ext]) {
      markdown = `# ${fileName}\n\n\`\`\`${codeLangs[ext]}\n${content.trim()}\n\`\`\``;
      docTitle = title || fileName;
    } else {
      markdown = content.trim();
      docTitle = title || extractTitle(markdown, fileName);
    }
  } else {
    markdown = typeof content === "string" ? content.trim() : String(content);
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
