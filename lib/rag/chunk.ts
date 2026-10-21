export type TextChunk = { index: number; content: string; tokenCount: number; section?: string; page?: number };
const TARGET_CHARS = 3200;
const OVERLAP_CHARS = 480;

function roughTokens(text: string) { return Math.ceil(text.length / 3.7); }

function splitOversized(block: string) {
  if (block.length <= TARGET_CHARS) return [block];
  const sentences = block.split(/(?<=[.!?。！？])\s+/).filter(Boolean);
  if (sentences.length < 2) return Array.from({ length: Math.ceil(block.length / TARGET_CHARS) }, (_, index) => block.slice(index * TARGET_CHARS, (index + 1) * TARGET_CHARS));
  const parts: string[] = []; let current = "";
  for (const sentence of sentences) { if (current && current.length + sentence.length + 1 > TARGET_CHARS) { parts.push(current); current = ""; } current += `${current ? " " : ""}${sentence}`; }
  if (current) parts.push(current);
  return parts;
}

function headingOf(block: string) {
  const markdown = block.match(/^(#{1,6})\s+(.+)$/m)?.[2];
  if (markdown) return markdown.trim();

  const underlined = block.match(/^([가-힣A-Za-z0-9][^\n]{1,80})\n(?:=+|-+)$/m)?.[1];
  if (underlined) return underlined.trim();

  const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
  const first = lines[0] ?? "";
  if (/^Q[.．:)\s]/i.test(first) && first.length <= 120) return first;

  // 워드·PDF에서 추출된 문서는 Markdown 표식 없이 "연차\nQ. ..."처럼 들어옵니다.
  // 첫 줄이 짧고 문장형 종결부호·URL·목록 번호가 없을 때만 섹션명으로 봅니다.
  if (
    lines.length >= 2
    && first.length >= 2
    && first.length <= 40
    && !/[.!?。！？:]$/.test(first)
    && !/^https?:\/\//i.test(first)
    && !/^\d+[.)]\s/.test(first)
    && !first.includes("|")
  ) return first;

  return "";
}

export function chunkText(input: string): TextChunk[] {
  const text = input.trim(); if (!text) return [];
  const blocks = text.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).flatMap(splitOversized);
  const output: TextChunk[] = []; let current = ""; let section = "";
  // flush 후 current 에는 다음 청크로 이어 붙일 겹침(overlap) 꼬리만 남습니다.
  // 그 꼬리는 이미 앞 청크에 포함된 내용이라 그것만으로는 청크를 만들지 않습니다.
  let carriedOverlap = "";
  const flush = () => {
    if (!current.trim() || current === carriedOverlap) return;
    output.push({ index: output.length, content: current.trim(), tokenCount: roughTokens(current), section: section || undefined });
    carriedOverlap = current.slice(Math.max(0, current.length - OVERLAP_CHARS));
    current = carriedOverlap;
  };
  for (const block of blocks) {
    const heading = headingOf(block);
    // 새 항목은 앞 항목과 한 청크에 섞지 않습니다. 그래야 제목/섹션 가중치가
    // "연차", "출산휴가", "경조사" 같은 실제 주제를 정확히 가리킵니다.
    if (heading) {
      if (current && current !== carriedOverlap) flush();
      // 서로 다른 섹션 사이에는 overlap을 넘기지 않습니다.
      current = "";
      carriedOverlap = "";
      section = heading;
    }
    if (current && current.length + block.length + 2 > TARGET_CHARS) flush();
    current += `${current ? "\n\n" : ""}${block}`;
  }
  flush(); return output;
}
