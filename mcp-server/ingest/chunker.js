import { splitSentencesMultilingual } from "./sentence_segmenter.js";

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

const CODE_SIGNATURE_REGEX = /^\s*(?:export\s+|async\s+)?(?:function|class|def|pub\s+fn|fn|struct|interface|enum)\s+/;

function _classifyLine(line) {
  const t = line.trimStart();
  if (t.startsWith("/**")) return "jsdoc_start";
  if (t.startsWith("*/")) return "jsdoc_end";
  if (t.startsWith("*")) return "jsdoc_mid";
  if (t.startsWith("//")) return "line_comment";
  if (t.startsWith("#")) return "hash_comment";
  if (t.startsWith("'''") || t.startsWith('"""')) return "py_docstring";
  return "code";
}

export function extractCodeSignatures(codeContent) {
  const lines = codeContent.split("\n");
  const signatures = [];

  const fenceMatch = lines[0] && lines[0].match(/^(\s*)(```|~~~)/);
  const bodyStart = fenceMatch ? 1 : 0
  const bodyEnd = fenceMatch && (lines[lines.length - 1].startsWith("```") || lines[lines.length - 1].startsWith("~~~")) ? lines.length - 1 : lines.length;
  const bodyLines = lines.slice(bodyStart, bodyEnd);

  let i = 0;
  while (i < bodyLines.length) {
    const line = bodyLines[i];
    const type = _classifyLine(line);

    if (type === "jsdoc_start") {
      const jsdocBlock = [line];
      let j = i + 1;
      while (j < bodyLines.length) {
        jsdocBlock.push(bodyLines[j]);
        if (_classifyLine(bodyLines[j]) === "jsdoc_end") {
          j++;
          break;
        }
        j++;
      }

      if (j < bodyLines.length && CODE_SIGNATURE_REGEX.test(bodyLines[j])) {
        const sigLines = [bodyLines[j]];
        const pyDocResult = _tryPyDocstring(bodyLines, j + 1);
        if (pyDocResult.docLines.length > 0) {
          sigLines.push(...pyDocResult.docLines);
        }
        const endIdx = pyDocResult.docLines.length > 0 ? pyDocResult.endIdx : j;

        signatures.push({
          signature: [...jsdocBlock, ...sigLines].join("\n").trim(),
          line_number: j + bodyStart + 1,
        });
        i = endIdx + 1;
        continue;
      }

      i = j;
      continue;
    }

    if (type === "line_comment" || type === "hash_comment") {
      const commentBlock = [line];
      let j = i + 1;
      while (j < bodyLines.length && _classifyLine(bodyLines[j]) === type) {
        commentBlock.push(bodyLines[j]);
        j++;
      }

      if (j < bodyLines.length && CODE_SIGNATURE_REGEX.test(bodyLines[j])) {
        const sigLines = [bodyLines[j]];
        const pyDocResult = _tryPyDocstring(bodyLines, j + 1);
        if (pyDocResult.docLines.length > 0) {
          sigLines.push(...pyDocResult.docLines);
        }
        const endIdx = pyDocResult.docLines.length > 0 ? pyDocResult.endIdx : j;

        signatures.push({
          signature: [...commentBlock, ...sigLines].join("\n").trim(),
          line_number: j + bodyStart + 1,
        });
        i = endIdx + 1;
        continue;
      }

      i = j;
      continue;
    }

    if (CODE_SIGNATURE_REGEX.test(line)) {
      const sigLines = [line];
      const pyDocResult = _tryPyDocstring(bodyLines, i + 1);
      if (pyDocResult.docLines.length > 0) {
        sigLines.push(...pyDocResult.docLines);
      }
      const endIdx = pyDocResult.docLines.length > 0 ? pyDocResult.endIdx : i;

      signatures.push({
        signature: sigLines.join("\n").trim(),
        line_number: i + bodyStart + 1,
      });
      i = endIdx + 1;
      continue;
    }

    i++;
  }

  return signatures;
}

function _tryPyDocstring(bodyLines, startIdx) {
  let k = startIdx;
  while (k < bodyLines.length && bodyLines[k].trim() === "") k++;
  if (k >= bodyLines.length) return { docLines: [], endIdx: startIdx - 1 };

  const line = bodyLines[k];
  const tripleDouble = /^\s*"""/.test(line);
  const tripleSingle = /^\s*'''/.test(line);
  const marker = tripleDouble ? '"""' : tripleSingle ? "'''" : null;
  if (!marker) return { docLines: [], endIdx: startIdx - 1 };

  const docLines = [line];
  if (line.includes(marker.repeat(2)) && line.indexOf(marker) !== line.lastIndexOf(marker)) {
    return { docLines, endIdx: k };
  }

  for (let m = k + 1; m < bodyLines.length; m++) {
    docLines.push(bodyLines[m]);
    if (bodyLines[m].includes(marker)) {
      return { docLines, endIdx: m };
    }
  }
  return { docLines, endIdx: k };
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
  let currentBlockType = "paragraph";

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

    const isListLine = /^\s*([*+-]|\d+\.)\s+/.test(line);
    if (isListLine) {
      if (currentBlockType !== "list" && currentBlockType !== "paragraph" && currentLines.length > 0) {
        pushCurrentBlock();
      }
      currentBlockType = "list";
      currentLines.push(line);
      continue;
    }

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
    const signatures = extractCodeSignatures(content);
    for (const sig of signatures) {
      makeChunk(sig.signature, {
        retrieval_policy: "code_signature",
        policy_source_id: mediumBlock.id,
      });
    }

    if (tokenCount <= 350) {
      makeChunk(content, { retrieval_policy: "micro_chunk" });
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
      makeChunk(fullChunk, { retrieval_policy: "micro_chunk" });
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
