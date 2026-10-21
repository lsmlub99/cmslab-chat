/** 기존 겹침 청크에서 업로드 당시 본문을 최대한 복원합니다. */
export function reconstructDocument(chunks: string[]) {
  let output = "";
  for (const raw of chunks) {
    const next = raw.trim();
    if (!next) continue;
    if (!output) {
      output = next;
      continue;
    }
    if (output.includes(next)) continue;

    const max = Math.min(1_200, output.length, next.length);
    let overlap = 0;
    for (let size = max; size >= 40; size -= 1) {
      if (output.endsWith(next.slice(0, size))) {
        overlap = size;
        break;
      }
    }
    output += overlap ? next.slice(overlap) : `\n\n${next}`;
  }
  return output.trim();
}

