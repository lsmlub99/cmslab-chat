export type TextChunk = {
  index: number;
  content: string;
  tokenCount: number;
  section?: string;
  page?: number;
};

const TARGET_CHARS = 1_800;
const OVERLAP_CHARS = 240;

type SemanticBlock = {
  content: string;
  section?: string;
  isolated: boolean;
};

function roughTokens(text: string) {
  return Math.ceil(text.length / 3.7);
}

function isQuestion(line: string) {
  return /^(?:Q(?:uestion)?[.:)]|질문\s*[:：])/iu.test(line.trim());
}

function isStandaloneHeading(line: string, nextMeaningfulLine: string) {
  const value = line.trim();
  if (!value || value.length < 2 || value.length > 50) return false;
  if (/^(?:Q(?:uestion)?|A(?:nswer)?|질문|답변|근거|출처)\s*[.:：)]/iu.test(value)) return false;
  if (/^https?:\/\//iu.test(value) || /^[-*•]|^\d+[.)]\s/u.test(value) || value.includes("|")) return false;
  if (/[.!?。！？]$/u.test(value)) return false;
  return isQuestion(nextMeaningfulLine);
}

function nextNonEmptyLine(lines: string[], start: number) {
  for (let index = start; index < lines.length; index += 1) {
    const value = lines[index].trim();
    if (value) return value;
  }
  return "";
}

/**
 * Legacy HR documents often use single newlines instead of blank lines between
 * headings and Q/A entries. Treat each Q/A entry as an independent retrieval
 * unit so unrelated policies do not end up in the same search result.
 */
function splitSemanticBlocks(input: string): SemanticBlock[] {
  const lines = input.replace(/\r\n?/g, "\n").split("\n");
  const blocks: SemanticBlock[] = [];
  let activeHeading = "";
  let current: string[] = [];
  let currentSection = "";
  let qaMode = false;

  const flush = () => {
    const content = current.join("\n").trim();
    if (content) blocks.push({ content, section: currentSection || undefined, isolated: qaMode });
    current = [];
    currentSection = "";
    qaMode = false;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (!qaMode) flush();
      continue;
    }

    const next = nextNonEmptyLine(lines, index + 1);
    if (isStandaloneHeading(line, next)) {
      flush();
      activeHeading = line;
      continue;
    }

    if (isQuestion(line)) {
      flush();
      current = activeHeading ? [activeHeading, line] : [line];
      currentSection = activeHeading ? `${activeHeading} · ${line}` : line;
      qaMode = true;
      continue;
    }

    current.push(line);
  }
  flush();
  return blocks;
}

function splitOversized(block: SemanticBlock): SemanticBlock[] {
  if (block.content.length <= TARGET_CHARS) return [block];
  const sentences = block.content.split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
  if (sentences.length < 2) {
    return Array.from({ length: Math.ceil(block.content.length / TARGET_CHARS) }, (_, index) => ({
      ...block,
      content: block.content.slice(index * TARGET_CHARS, (index + 1) * TARGET_CHARS),
    }));
  }

  const parts: SemanticBlock[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > TARGET_CHARS) {
      parts.push({ ...block, content: current });
      current = "";
    }
    current += `${current ? " " : ""}${sentence}`;
  }
  if (current) parts.push({ ...block, content: current });
  return parts;
}

function headingOf(block: string) {
  const markdown = block.match(/^(#{1,6})\s+(.+)$/m)?.[2];
  if (markdown) return markdown.trim();

  const underlined = block.match(/^([^\n]{2,80})\n(?:=+|-+)$/m)?.[1];
  if (underlined) return underlined.trim();

  const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  if (isQuestion(first) && first.length <= 140) return first;
  return "";
}

export function chunkText(input: string): TextChunk[] {
  const text = input.trim();
  if (!text) return [];

  const blocks = splitSemanticBlocks(text).flatMap(splitOversized);
  const output: TextChunk[] = [];
  let current = "";
  let section = "";
  let carriedOverlap = "";

  const flush = () => {
    if (!current.trim() || current === carriedOverlap) return;
    output.push({
      index: output.length,
      content: current.trim(),
      tokenCount: roughTokens(current),
      section: section || undefined,
    });
    carriedOverlap = current.slice(Math.max(0, current.length - OVERLAP_CHARS));
    current = carriedOverlap;
  };

  for (const block of blocks) {
    const detectedHeading = block.section || headingOf(block.content);

    if (block.isolated) {
      if (current && current !== carriedOverlap) flush();
      current = "";
      carriedOverlap = "";
      section = detectedHeading || section;
      current = block.content;
      flush();
      current = "";
      carriedOverlap = "";
      continue;
    }

    if (detectedHeading) {
      if (current && current !== carriedOverlap) flush();
      current = "";
      carriedOverlap = "";
      section = detectedHeading;
    }
    if (current && current.length + block.content.length + 2 > TARGET_CHARS) flush();
    current += `${current ? "\n\n" : ""}${block.content}`;
  }

  flush();
  return output;
}
