/**
 * 한국어 질문에서 검색용 키워드를 뽑습니다.
 *
 * 왜 필요한가: public.documents.content_fts 는 to_tsvector('simple', content) 입니다.
 * 'simple' 사전은 형태소 분석을 하지 않으므로 "연차를"과 "연차"를 다른 토큰으로 봅니다.
 * 실제로 사내 질문 6개를 넣어 보면 FTS 매칭이 전부 0건이었습니다.
 * 그래서 조사를 떼어낸 어간을 만들어 ilike 부분일치에 함께 넘깁니다.
 */

// 길이가 긴 것부터 떼어내야 "에서"가 "서"보다 먼저 걸립니다.
const PARTICLES = [
  "으로부터", "이라고", "에서는", "에게서", "라고는", "까지는", "부터는",
  "에서", "에게", "한테", "으로", "라도", "이나", "조차", "마저", "밖에", "처럼", "보다",
  "까지", "부터", "이란", "라는", "이라", "은", "는", "이", "가", "을", "를", "와", "과",
  "의", "에", "로", "도", "만", "나", "께", "요",
];

// 질문 형태를 만드는 군더더기 — 검색어로는 잡음입니다.
const STOPWORDS = new Set([
  "알려줘", "알려주세요", "알려", "궁금해요", "궁금해", "궁금", "궁금한데", "무엇", "뭐야", "뭔가요",
  "어떻게", "어떤", "어디", "어디서", "어디에", "언제", "누구", "얼마", "왜", "인가요", "있나요",
  "하나요", "되나요", "될까요", "인지", "인데", "합니까", "그리고", "또는", "관련", "대해", "대한",
  "해주세요", "해줘", "주세요", "please", "the", "and", "for", "with", "how", "what", "where",
]);

/** 조사를 떼어낸 어간. 떼어낼 것이 없으면 원본을 그대로 돌려줍니다. */
export function stripParticle(token: string) {
  if (!/[가-힣]$/.test(token)) return token;
  for (const particle of PARTICLES) {
    if (token.length - particle.length >= 2 && token.endsWith(particle)) {
      return token.slice(0, -particle.length);
    }
  }
  return token;
}

/**
 * ilike 부분일치에 쓸 키워드 목록.
 * 원형과 어간을 모두 넣어 "연차를 신청"과 "연차 신청" 양쪽을 다 잡습니다.
 */
export function keywordTerms(question: string, limit = 12) {
  const tokens = question
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

  const terms = new Set<string>();
  for (const token of tokens) {
    const lowered = token.toLowerCase();
    if (STOPWORDS.has(lowered)) continue;
    if (token.length >= 2) terms.add(token);
    const stem = stripParticle(token);
    if (stem.length >= 2 && stem !== token && !STOPWORDS.has(stem.toLowerCase())) terms.add(stem);
  }

  // 긴 키워드가 더 변별력이 높으므로 우선 남깁니다.
  return [...terms].sort((a, b) => b.length - a.length).slice(0, limit);
}

/** websearch_to_tsquery 에 넘길 문자열. 어간으로 바꿔야 그나마 매칭 확률이 올라갑니다. */
export function ftsQuery(question: string) {
  return keywordTerms(question, 10).join(" ") || question.trim();
}
