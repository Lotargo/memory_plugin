export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

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
    const headerMatch = line.match(/^(#{1 mourn|#{1,6})\s+(.+)$/);
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

export function createMicroChunks(section, sectionId, docId, targetChunkTokens = 200, overlapTokens = 30) {
  const maxChars = targetChunkTokens * 4;
  const overlapChars = overlapTokens * 4;

  const content = section.content;
  const microChunks = [];

  if (content.length <= maxChars) {
    microChunks.push({
      id: `${sectionId}_m0`,
      section_id: sectionId,
      doc_id: docId,
      content,
      breadcrumbs: section.breadcrumbs,
      token_count: estimateTokens(content),
    });
    return microChunks;
  }

  const paragraphs = content.split(/\n\s*\n/);
  let currentChunk = "";
  let chunkIndex = 0;

  for (const para of paragraphs) {
    if ((currentChunk + "\n\n" + para).length > maxChars && currentChunk.length > 0) {
      microChunks.push({
        id: `${sectionId}_m${chunkIndex++}`,
        section_id: sectionId,
        doc_id: docId,
        content: currentChunk.trim(),
        breadcrumbs: section.breadcrumbs,
        token_count: estimateTokens(currentChunk),
      });

      const tail = currentChunk.slice(-overlapChars);
      currentChunk = tail + "\n\n" + para;
    } else {
      currentChunk = currentChunk ? currentChunk + "\n\n" + para : para;
    }
  }

  if (currentChunk.trim().length > 0) {
    microChunks.push({
      id: `${sectionId}_m${chunkIndex++}`,
      section_id: sectionId,
      doc_id: docId,
      content: currentChunk.trim(),
      breadcrumbs: section.breadcrumbs,
      token_count: estimateTokens(currentChunk),
    });
  }

  return microChunks;
}

export function buildTripleHierarchy(markdown, docId, docTitle = "Document") {
  const sectionsData = parseSections(markdown, docTitle);
  const sections = [];
  const microChunks = [];
  const tocTree = [];

  sectionsData.forEach((sec, idx) => {
    const sectionId = `${docId}_s${idx}`;
    sections.push({
      id: sectionId,
      doc_id: docId,
      heading: sec.heading,
      breadcrumbs: sec.breadcrumbs,
      content: sec.content,
      token_count: sec.token_count,
    });

    tocTree.push({
      section_id: sectionId,
      heading: sec.heading,
      breadcrumbs: sec.breadcrumbs,
    });

    const micros = createMicroChunks(sec, sectionId, docId);
    microChunks.push(...micros);
  });

  return {
    toc: JSON.stringify(tocTree),
    sections,
    microChunks,
  };
}
