/**
 * 검색 튜닝 값.
 *
 * 임계값을 왜 이 숫자로 잡았는가 — 실제 적재된 36개 청크에 사내 질문을 넣어
 * text-embedding-3-small 코사인 유사도를 측정한 결과입니다.
 *
 *   "리페라 장비 사용법"          → 0.61 / 0.54  (정답 문서)
 *   "연차 휴가 어떻게 신청해?"     → 0.48 ~ 0.41  (정답 문서)
 *   "경조사 지원금 신청 방법"      → 0.47        (정답 문서)
 *   "26년 전사 일정 알려줘"        → 0.35        (정답 문서)
 *   "노트북 고장났는데 어디에?"    → 0.29        (정답 문서)
 *   "점심 메뉴 추천해줘"           → 0.38        (오답 — 무관한 질문)
 *
 * 기존 설정값 0.72 는 정답 문서조차 전부 탈락시켰습니다. 이게 "임베딩이 아무것도
 * 못 찾는" 원인이었습니다. 반대로 무관한 질문(0.38)과 정답(0.29)의 구간이 겹치기
 * 때문에 코사인 값 하나로는 무관한 질문을 걸러낼 수 없습니다.
 *
 * 그래서 2단 구조로 갑니다.
 *  1) CANDIDATE_THRESHOLD — 후보로 넘길 하한선(느슨하게)
 *  2) 최종 판단은 모델에게 맡기고, 모델이 "근거가 부족합니다"라고 하면 미답변 처리
 * 키워드가 명확히 걸린 청크는 코사인 하한선을 우회시킵니다.
 */

function num(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** 이 값 미만이면서 키워드도 안 걸린 청크는 근거로 쓰지 않습니다. */
export const CANDIDATE_THRESHOLD = num("RAG_SIMILARITY_THRESHOLD", 0.24);

/**
 * 최고 유사도가 이 값도 못 넘고 키워드도 여러 개 안 걸리면 모델을 부르지 않고 미답변 처리.
 * 관문을 좁히면 정답을 막습니다 — 0.3 에서는 "노트북 고장났는데 어디에 요청하나요"의
 * 정답 문서(0.289)까지 탈락했습니다. 관련성의 최종 판단은 모델이 하므로 느슨하게 둡니다.
 */
export const TOP_MATCH_THRESHOLD = num("RAG_TOP_MATCH_THRESHOLD", 0.25);

/** 모델에 넘길 근거 청크 수. */
export const MATCH_COUNT = num("RAG_MATCH_COUNT", 6);

/** 벡터·FTS·키워드 각 신호에서 뽑을 후보 수. */
export const CANDIDATE_COUNT = num("RAG_CANDIDATE_COUNT", 40);

/** 근거 본문 전체 길이 상한(문자). 청크가 커도 컨텍스트가 폭주하지 않게 잘라 냅니다. */
export const CONTEXT_CHAR_BUDGET = num("RAG_CONTEXT_CHARS", 12_000);

/** 모델이 근거 부족을 알릴 때 쓰는 문구 — 미답변 판정에 사용합니다. */
export const INSUFFICIENT_MARKER = "근거가 부족합니다";
