type RankableSearchRow = {
  content?: string;
  similarity: number;
  keywordHits: number;
  metadata: Record<string, unknown>;
};

/** 제목·섹션에 핵심어가 직접 등장하는 횟수입니다. */
export function metadataKeywordHits(metadata: Record<string, unknown>, terms: string[]) {
  const title = String(metadata.title ?? metadata.fileName ?? "").toLocaleLowerCase("ko-KR");
  const section = String(metadata.section ?? "").toLocaleLowerCase("ko-KR");
  const aliases = Array.isArray(metadata.search_aliases)
    ? metadata.search_aliases.join(" ").toLocaleLowerCase("ko-KR")
    : String(metadata.search_aliases ?? "").toLocaleLowerCase("ko-KR");
  const unique = [...new Set(terms.map(term => term.trim().toLocaleLowerCase("ko-KR")).filter(term => term.length >= 2))];
  return {
    title: unique.filter(term => title.includes(term)).length,
    section: unique.filter(term => section.includes(term)).length,
    aliases: unique.filter(term => aliases.includes(term)).length,
  };
}

export function governanceRankBoost(metadata: Record<string, unknown>, today = new Date()) {
  const authority = String(metadata.authority ?? "reference");
  const priority = Math.min(100, Math.max(0, Number(metadata.priority ?? 50))) / 100;
  const expiresAt = metadata.expires_at ? new Date(String(metadata.expires_at)) : null;
  const expired = expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < today.getTime();
  if (expired) return -0.2;
  const authorityBoost = authority === "official" ? 0.05 : authority === "draft" ? -0.05 : 0;
  return authorityBoost + priority * 0.03;
}

function orderedTermBoost(value: unknown, terms: string[], weight: number) {
  const text = String(value ?? "").toLocaleLowerCase("ko-KR");
  const unique = [...new Set(terms.map(term => term.trim().toLocaleLowerCase("ko-KR")).filter(term => term.length >= 2))];
  return unique.reduce((score, term, index) => (
    text.includes(term) ? score + weight / (index + 1) : score
  ), 0);
}

/**
 * 코사인 유사도를 주 신호로 두고, 질문의 핵심어가 제목·섹션에 직접 있는 문서를 우대합니다.
 * 제목 가중치는 "복리후생" 질문에서 포인터 성격의 Q&A보다 실제 복리후생 문서를 먼저
 * 가져오기 위한 값이며, 최대치를 제한해 어휘 일치만으로 결과를 독점하지 않게 합니다.
 */
export function searchRankScore(row: RankableSearchRow, terms: string[]) {
  const metadataHits = metadataKeywordHits(row.metadata, terms);
  const aliases = Array.isArray(row.metadata.search_aliases)
    ? row.metadata.search_aliases.join(" ")
    : row.metadata.search_aliases;
  return row.similarity
    + 0.03 * Math.min(row.keywordHits, 3)
    + 0.18 * Math.min(metadataHits.title, 2)
    + 0.12 * Math.min(metadataHits.section, 2)
    + 0.04 * Math.min(metadataHits.aliases, 2)
    // Expanded terms are ordered from the user's wording to broader synonyms.
    // Reward early, specific matches so "연차" beats a generic "휴가" match.
    + orderedTermBoost(row.metadata.title ?? row.metadata.fileName, terms, 0.12)
    + orderedTermBoost(row.metadata.section, terms, 0.08)
    + orderedTermBoost(aliases, terms, 0.03)
    // DB의 RRF 상위 일부만으로 자르면 정확한 본문 일치가 의미 검색 결과에 밀릴 수 있습니다.
    // 사용자가 실제로 쓴 표현을 본문에서 찾은 경우에는 작게 우대합니다.
    + orderedTermBoost(row.content, terms, 0.08)
    + governanceRankBoost(row.metadata);
}
