export type HistoryTurn = { question: string; answer: string };

/**
 * 전체 대화는 DB에 남기되, 매 요청에는 최근 대화만 전달해 토큰 사용량과 응답 지연을 제한합니다.
 */
export const HISTORY_TURNS = 6;

/**
 * "그럼 신청은?" 같은 후속 질문을 검색할 때 최근 질문의 주제를 복원합니다.
 */
export function buildSearchQuery(question: string, history: HistoryTurn[]) {
  const recentQuestions = history
    .slice(-3)
    .map(turn => turn.question.trim())
    .filter(Boolean);
  if (!recentQuestions.length) return question;

  // 대명사나 아주 짧은 질문일 때만 붙입니다. 주제가 바뀐 긴 질문까지 오염시키지 않으려는 것입니다.
  const looksDependent = question.length <= 20 || /그럼|그거|그건|그때|거기|위에|아까|더|또/u.test(question);
  return looksDependent ? `${recentQuestions.join(" ")} ${question}` : question;
}
