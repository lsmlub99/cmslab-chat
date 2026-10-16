import type { Citation } from "@/lib/types";

const CITATION_REFERENCE = /\[출처\s*(\d+)\]/g;

export function selectReferencedItems<T>(answer: string, items: T[]) {
  const referenced = new Set<number>();
  for (const match of answer.matchAll(CITATION_REFERENCE)) {
    const index = Number(match[1]);
    if (Number.isInteger(index) && index >= 1 && index <= items.length) referenced.add(index);
  }
  return referenced.size
    ? items.filter((_, index) => referenced.has(index + 1))
    : items;
}

/** 모델이 실제로 표시한 출처만 남기고, 같은 문서의 여러 청크는 한 번만 보여 줍니다. */
export function selectUsedCitations(answer: string, citations: Citation[]) {
  const seen = new Set<string>();
  return selectReferencedItems(answer, citations).filter(citation => {
    const key = `${citation.title.trim().toLocaleLowerCase("ko-KR")}|${citation.sourceUrl?.trim() ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 답변 본문과 별도의 근거 목록이 함께 보일 때 중복되는 [출처 N] 표시는 숨깁니다. */
export function stripCitationReferences(answer: string) {
  return answer
    .replace(/\s*\[출처\s*\d+\]\s*(?:[,·]\s*)?/g, " ")
    .replace(/[ \t]+([.,!?])/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
