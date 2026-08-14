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
    const heading = block.match(/^(#{1,6})\s+(.+)$/m)?.[2] || block.match(/^([가-힣A-Za-z0-9][^\n]{1,80})\n(?:=+|-+)$/m)?.[1];
    if (heading) section = heading.trim();
    if (current && current.length + block.length + 2 > TARGET_CHARS) flush();
    current += `${current ? "\n\n" : ""}${block}`;
  }
  flush(); return output;
}
