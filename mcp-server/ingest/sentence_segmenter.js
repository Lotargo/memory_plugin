// Multilingual Sentence Segmenter using Intl.Segmenter with Abbreviation & Boundary Protection

const RU_ABBREVIATIONS = new Set([
  "т.д", "т.п", "т.е", "и др", "г", "гг", "ул", "руб", "коп", "стр", "рис", "см", "им", "пер", "д", "к", "п", "в"
]);

const EN_ABBREVIATIONS = new Set([
  "e.g", "i.e", "etc", "vs", "dr", "mr", "mrs", "ms", "prof", "inc", "ltd", "co", "vol", "no", "p", "pp", "fig"
]);

function isAbbreviation(word) {
  if (!word) return false;
  const clean = word.trim().toLowerCase().replace(/\.$/, "");
  return RU_ABBREVIATIONS.has(clean) || EN_ABBREVIATIONS.has(clean);
}

export function splitSentencesMultilingual(text, langHint = "ru") {
  if (!text || typeof text !== "string") return [];
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  let rawSegments = [];

  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    try {
      const segmenter = new Intl.Segmenter([langHint, "ru", "en"], { granularity: "sentence" });
      const iter = segmenter.segment(trimmed);
      for (const seg of iter) {
        if (seg.segment.trim().length > 0) {
          rawSegments.push(seg.segment);
        }
      }
    } catch {
      rawSegments = fallbackSentenceSplit(trimmed);
    }
  } else {
    rawSegments = fallbackSentenceSplit(trimmed);
  }

  // Post-process & merge false splits caused by abbreviations or numbers (e.g., "v1.0", "e.g.", "т. д.")
  const sentences = [];
  let current = "";

  for (let i = 0; i < rawSegments.length; i++) {
    const seg = rawSegments[i];
    if (!current) {
      current = seg;
    } else {
      const lastWordMatch = current.trim().match(/([a-zA-Zа-яА-Я0-9._-]+)\s*\.?$/);
      const lastWord = lastWordMatch ? lastWordMatch[1] : "";
      
      const isNumDot = /\b\d+\.$/.test(current.trim());
      const isAbbr = isAbbreviation(lastWord) || isNumDot;
      const startsWithLowercase = /^[a-zа-я]/.test(seg.trim());

      if (isAbbr || startsWithLowercase) {
        current += seg;
      } else {
        sentences.push(current.trim());
        current = seg;
      }
    }
  }

  if (current && current.trim().length > 0) {
    sentences.push(current.trim());
  }

  return sentences;
}

function fallbackSentenceSplit(text) {
  return text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
}
