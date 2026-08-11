import { splitSentencesMultilingual } from "./sentence_segmenter.js";

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function generateTableSummary(tableContent, breadcrumbs = "") {
  const lines = tableContent.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  const headerLine = lines[0];
  const columns = headerLine
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  const separatorLine = lines[1] || "";
  const hasSeparator = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(separatorLine);
  const dataLines = hasSeparator ? lines.slice(2) : lines.slice(1);
  const rowCount = dataLines.length;

  const contextPart = breadcrumbs ? ` Context: ${breadcrumbs}.` : "";
  return `Table with columns [${columns.join(", ")}] containing ${rowCount} row${rowCount !== 1 ? "s" : ""}.${contextPart}`;
}

// 1. BIG LEVEL: Heading & Section Hierarchy Parser
export function parseSections(markdown, docTitle = "Document") {
  const lines = markdown.split("\n");
  const sections = [];
  const headerStack = [];

  let currentHeading = docTitle;
  let currentLines = [];

  function pushCurrentSection() {
    const content = currentLines.join("\n").trim();
    if (content.length > 0) {
      const breadcrumbs = [docTitle, ...headerStack.map((h) => h.text)].join(" > ");
      sections.push({
        heading: currentHeading,
        breadcrumbs,
        content,
        token_count: estimateTokens(content),
      });
    }
    currentLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      pushCurrentSection();

      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();

      while (headerStack.length > 0 && headerStack[headerStack.length - 1].level >= level) {
        headerStack.pop();
      }

      headerStack.push({ level, text });
      currentHeading = text;
    } else {
      currentLines.push(line);
    }
  }

  pushCurrentSection();

  if (sections.length === 0) {
    sections.push({
      heading: docTitle,
      breadcrumbs: docTitle,
      content: markdown.trim(),
      token_count: estimateTokens(markdown),
    });
  }

  return sections;
}

// 2. MEDIUM LEVEL: Logical Paragraphs & Structural Block Extractor
export function extractMediumBlocks(section, sectionId, docId) {
  const content = section.content;
  if (!content || content.trim().length === 0) return [];

  const lines = content.split("\n");
  const mediumBlocks = [];
  let blockIndex = 0;

  let currentLines = [];
  let currentBlockType = "paragraph"; // 'paragraph', 'code', 'table', 'list', 'blockquote'

  function pushCurrentBlock() {
    const blockContent = currentLines.join("\n").trim();
    if (blockContent.length > 0) {
      mediumBlocks.push({
        id: `${sectionId}_m${blockIndex++}`,
        section_id: sectionId,
        doc_id: docId,
        breadcrumbs: section.breadcrumbs,
        content: blockContent,
        block_type: currentBlockType,
        token_count: estimateTokens(blockContent),
      });
    }
    currentLines = [];
    currentBlockType = "paragraph";
  }

  let inFencedCode = false;
  let codeFenceMarker = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check code fence
    const fenceMatch = line.match(/^(\s*)(```|~~~)/);
    if (fenceMatch) {
      if (!inFencedCode) {
        if (currentLines.length > 0) pushCurrentBlock();
        inFencedCode = true;
        codeFenceMarker = fenceMatch[2];
        currentBlockType = "code";
        currentLines.push(line);
      } else {
        currentLines.push(line);
        if (line.includes(codeFenceMarker)) {
          inFencedCode = false;
          pushCurrentBlock();
        }
      }
      continue;
    }

    if (inFencedCode) {
      currentLines.push(line);
      continue;
    }

    // Check table line
    const isTableLine = /^\s*\|.*\|\s*$/.test(line);
    if (isTableLine) {
      if (currentBlockType !== "table" && currentLines.length > 0) {
        pushCurrentBlock();
      }
      currentBlockType = "table";
      currentLines.push(line);
      continue;
    } else if (currentBlockType === "table") {
      pushCurrentBlock();
    }

    // Check list item line
    const isListLine = /^\s*([*+-]|\d+\.)\s+/.test(line);
    if (isListLine) {
      if (currentBlockType !== "list" && currentBlockType !== "paragraph" && currentLines.length > 0) {
        pushCurrentBlock();
      }
      currentBlockType = "list";
      currentLines.push(line);
      continue;
    }

    // Check empty line
    if (line.trim().length === 0) {
      if (currentLines.length > 0) {
        pushCurrentBlock();
      }
      continue;
    }

    currentLines.push(line);
  }

  pushCurrentBlock();
  return mediumBlocks;
}

// 3. SMALL LEVEL: Sentence & Smart AST/Table Chunk Extractor
export function createSmallChunks(mediumBlock, sectionId, docId) {
  const content = mediumBlock.content;
  const tokenCount = mediumBlock.token_count || estimateTokens(content);
  const smallChunks = [];
  let smallIdx = 0;

  function makeChunk(chunkText, extraMeta = {}) {
    if (!chunkText || chunkText.trim().length === 0) return;
    const { retrieval_policy, policy_source_id, ...rest } = extraMeta;
    smallChunks.push({
      id: `${mediumBlock.id}_s${smallIdx++}`,
      medium_id: mediumBlock.id,
      section_id: sectionId,
      doc_id: docId,
      content: chunkText.trim(),
      breadcrumbs: mediumBlock.breadcrumbs,
      token_count: estimateTokens(chunkText),
      retrieval_policy: retrieval_policy || "micro_chunk",
      policy_source_id: policy_source_id || null,
      ...rest,
    });
  }

  // RULE FOR TABLES
  if (mediumBlock.block_type === "table") {
    const summary = generateTableSummary(content, mediumBlock.breadcrumbs);
    if (summary) {
      makeChunk(summary, {
        retrieval_policy: "table_summary",
        policy_source_id: mediumBlock.id,
      });
    }

    if (tokenCount <= 350) {
      makeChunk(content, { retrieval_policy: "micro_chunk" });
      return smallChunks;
    }

    const lines = content.split("\n");
    const headerLines = [];
    const dataLines = [];

    for (const l of lines) {
      if (headerLines.length < 2 && (l.includes("|---") || l.includes("|:--") || headerLines.length === 0)) {
        headerLines.push(l);
      } else {
        dataLines.push(l);
      }
    }

    const headerStr = headerLines.join("\n");
    const chunkSize = 8;
    for (let i = 0; i < dataLines.length; i += chunkSize) {
      const rowBatch = dataLines.slice(i, i + chunkSize);
      const tableChunkText = `${headerStr}\n${rowBatch.join("\n")}`;
      makeChunk(tableChunkText, { retrieval_policy: "micro_chunk" });
    }
    return smallChunks;
  }

  // RULE FOR CODE BLOCKS
  if (mediumBlock.block_type === "code") {
    if (tokenCount <= 350) {
      makeChunk(content);
      return smallChunks;
    }

    const codeLines = content.split("\n");
    const firstLine = codeLines[0] || "";
    const lastLine = codeLines[codeLines.length - 1] || "";
    const isFenced = firstLine.startsWith("```") || firstLine.startsWith("~~~");
    const fenceHeader = isFenced ? firstLine : "";
    const fenceFooter = isFenced && (lastLine.startsWith("```") || lastLine.startsWith("~~~")) ? lastLine : "";

    const bodyLines = isFenced ? codeLines.slice(1, -1) : codeLines;

    const astBlocks = [];
    let currentAstBlock = [];

    for (const line of bodyLines) {
      const isBoundary = /^\s*(?:export\s+|async\s+)?(?:function|class|def|pub\s+fn|fn|struct|interface|enum)\s+/.test(line);
      if (isBoundary && currentAstBlock.length > 0) {
        astBlocks.push(currentAstBlock.join("\n"));
        currentAstBlock = [];
      }
      currentAstBlock.push(line);
    }
    if (currentAstBlock.length > 0) {
      astBlocks.push(currentAstBlock.join("\n"));
    }

    for (const block of astBlocks) {
      const fullChunk = fenceHeader ? `${fenceHeader}\n${block}\n${fenceFooter}` : block;
      makeChunk(fullChunk);
    }
    return smallChunks;
  }

  // STANDARD SENTENCE SEGMENTATION WITH SAFE SENTENCE-WINDOWING (100-180 TOKENS, 1 SENTENCE OVERLAP)
  const sentences = splitSentencesMultilingual(content);
  if (sentences.length === 0 || tokenCount <= 180) {
    makeChunk(content);
    return smallChunks;
  }

  const TARGET_WINDOW_TOKENS = 150;
  let currentWindow = [];
  let currentTokens = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sTokens = estimateTokens(sentence);

    if (currentTokens + sTokens > TARGET_WINDOW_TOKENS && currentWindow.length > 0) {
      makeChunk(currentWindow.join(" "));
      
      // Safe Overlap: Keep the last sentence of the previous window if available
      const lastSentence = currentWindow[currentWindow.length - 1];
      currentWindow = [lastSentence, sentence];
      currentTokens = estimateTokens(lastSentence) + sTokens;
    } else {
      currentWindow.push(sentence);
      currentTokens += sTokens;
    }
  }

  if (currentWindow.length > 0) {
    makeChunk(currentWindow.join(" "));
  }

  return smallChunks;
}

export function createMicroChunks(section, sectionId, docId) {
  const mediumBlocks = extractMediumBlocks(section, sectionId, docId);
  const microChunks = [];
  for (const med of mediumBlocks) {
    const smalls = createSmallChunks(med, sectionId, docId);
    microChunks.push(...smalls);
  }
  return microChunks;
}

// 4. TRIPLE HIERARCHY BUILDER: Big -> Medium -> Small Reference Tree
export function buildTripleHierarchy(markdown, docId, docTitle = "Document") {
  const sectionsData = parseSections(markdown, docTitle);
  const sections = [];
  const mediumChunks = [];
  const microChunks = [];
  const tocTree = [];

  sectionsData.forEach((sec, idx) => {
    const sectionId = `${docId}_s${idx}`;
    const sectionObj = {
      id: sectionId,
      doc_id: docId,
      heading: sec.heading,
      breadcrumbs: sec.breadcrumbs,
      content: sec.content,
      token_count: sec.token_count,
    };
    sections.push(sectionObj);

    tocTree.push({
      section_id: sectionId,
      heading: sec.heading,
      breadcrumbs: sec.breadcrumbs,
    });

    const mediums = extractMediumBlocks(sec, sectionId, docId);
    mediumChunks.push(...mediums);

    for (const med of mediums) {
      const smalls = createSmallChunks(med, sectionId, docId);
      microChunks.push(...smalls);
    }
  });

  return {
    toc: JSON.stringify(tocTree),
    sections,
    mediumChunks,
    microChunks,
  };
}
