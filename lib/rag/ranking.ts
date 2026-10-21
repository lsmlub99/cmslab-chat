type RankableSearchRow = {
  similarity: number;
  keywordHits: number;
  metadata: Record<string, unknown>;
};

/** 제목·섹션에 핵심어가 직접 등장하는 횟수입니다. */
export function metadataKeywordHits(metadata: Record<string, unknown>, terms: string[]) {
  const title = String(metadata.title ?? metadata.fileName ?? "").toLocaleLowerCase("ko-KR");
  const section = String(metadata.section ?? "").toLocaleLowerCase("ko-KR");
  const unique = [...new Set(terms.map(term => term.trim().toLocaleLowerCase("ko-KR")).filter(term => term.length >= 2))];
  return {
    title: unique.filter(term => title.includes(term)).length,
    section: unique.filter(term => section.includes(term)).length,
  };
}

/**
 * 코사인 유사도를 주 신호로 두고, 질문의 핵심어가 제목·섹션에 직접 있는 문서를 우대합니다.
 * 제목 가중치는 "복리후생" 질문에서 포인터 성격의 Q&A보다 실제 복리후생 문서를 먼저
 * 가져오기 위한 값이며, 최대치를 제한해 어휘 일치만으로 결과를 독점하지 않게 합니다.
 */
export function searchRankScore(row: RankableSearchRow, terms: string[]) {
  const metadataHits = metadataKeywordHits(row.metadata, terms);
  return row.similarity
    + 0.03 * Math.min(row.keywordHits, 3)
    + 0.07 * Math.min(metadataHits.title, 2)
    + 0.04 * Math.min(metadataHits.section, 2);
}
