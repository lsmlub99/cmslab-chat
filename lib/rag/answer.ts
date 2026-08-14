import type { Citation } from "@/lib/types";
import { chatModel, openai } from "@/lib/openai";
import { CONTEXT_CHAR_BUDGET, INSUFFICIENT_MARKER } from "@/lib/rag/config";

export function answerInstructions() {
  return `당신은 팀 내부 지식베이스 챗봇입니다.

규칙
- 제공된 KNOWLEDGE CONTEXT 안의 정보만 사용하세요. 일반 상식이나 외부 지식으로 보충하지 마세요.
- 근거에 없는 사내 규정, 금액, 일수, 일정, 담당자, URL을 만들어 내지 마세요.
- 답변의 모든 문장은 근거 문서에 실제로 적혀 있어야 합니다. 회사에서 흔히 그렇게 한다는 이유로,
  또는 일반적으로 알려진 절차라는 이유로 문장을 지어내지 마세요.
- 근거가 질문과 주제만 비슷하고 질문에 대한 답을 담고 있지 않다면, 그럴듯하게 엮지 말고
  "${INSUFFICIENT_MARKER}" 라고만 답하세요. 억지로 답하는 것보다 모른다고 하는 편이 낫습니다.
- 한국어로, 3~6문장 안에서 실무자가 바로 실행할 수 있게 답하세요. 절차는 "1." "2." 처럼 번호로 쓰세요.
- 마크다운 서식을 쓰지 마세요. **굵게**, __밑줄__, \`코드\`, # 제목, 표 기호를 출력하지 마세요. 순수한 문장으로만 쓰세요.
- 따옴표는 곧은 따옴표(")만 쓰고, 굳이 필요하지 않으면 따옴표를 쓰지 마세요.
- 근거에 링크가 있으면 그 링크를 그대로 안내하세요.
- 문서끼리 내용이 충돌하면 두 내용을 함께 알리고 관리자 확인이 필요하다고 쓰세요.
- 답변 마지막 줄에 실제로 사용한 출처만 [출처 1], [출처 3] 형식으로 표시하세요. 사용하지 않은 출처는 쓰지 마세요.
- 질문과 근거가 무관하거나 답하기에 정보가 모자라면, 추측하지 말고 "${INSUFFICIENT_MARKER}" 라는 문장만 출력하세요.`;
}

export function contextFor(citations: Citation[], chunks: { content: string }[]) {
  const parts: string[] = [];
  let used = 0;

  for (const [index, citation] of citations.entries()) {
    const content = chunks[index]?.content ?? "";
    if (!content) continue;

    const remaining = CONTEXT_CHAR_BUDGET - used;
    if (remaining <= 200) break;

    const body = content.length > remaining ? `${content.slice(0, remaining)}…` : content;
    const label = [citation.title, citation.page ? `${citation.page}쪽` : ""].filter(Boolean).join(" · ");
    parts.push(`[출처 ${index + 1}] ${label}${citation.sourceUrl ? `\nURL: ${citation.sourceUrl}` : ""}\n${body}`);
    used += body.length;
  }

  return parts.join("\n\n---\n\n");
}

export type HistoryTurn = { question: string; answer: string };

/**
 * 이어지는 질문("그럼 얼마야?", "그건 어디서 신청해?")을 이해하려면
 * 모델에게 앞선 대화를 함께 줘야 합니다.
 * 토큰이 무한정 늘지 않도록 최근 몇 턴만 넘깁니다.
 */
export const HISTORY_TURNS = 4;

export async function streamAnswer(
  question: string,
  citations: Citation[],
  chunks: { content: string }[],
  history: HistoryTurn[] = [],
) {
  const client = openai();

  const messages = history.slice(-HISTORY_TURNS).flatMap(turn => [
    { role: "user" as const, content: turn.question },
    { role: "assistant" as const, content: turn.answer },
  ]);

  return client.responses.create({
    model: chatModel(),
    instructions: answerInstructions(),
    input: [
      ...messages,
      {
        role: "user" as const,
        content: `KNOWLEDGE CONTEXT\n${contextFor(citations, chunks)}\n\nUSER QUESTION\n${question}`,
      },
    ],
    stream: true,
  });
}

/**
 * 검색에 쓸 질문 문장을 만듭니다.
 *
 * "그럼 얼마야?" 만으로는 임베딩 검색이 아무것도 못 찾습니다.
 * 직전 질문을 앞에 붙여 주제를 복원합니다.
 */
export function buildSearchQuery(question: string, history: HistoryTurn[]) {
  const previous = history.at(-1)?.question;
  if (!previous) return question;

  // 대명사나 아주 짧은 질문일 때만 붙입니다. 주제가 바뀐 질문까지 오염시키지 않으려는 것입니다.
  const looksDependent = question.length <= 20 || /그럼|그거|그건|그때|거기|위에|아까|더|또/.test(question);
  return looksDependent ? `${previous} ${question}` : question;
}

/** 모델이 근거 부족을 알렸는지 판정합니다(미답변 대기열로 넘길지 결정). */
export function isInsufficient(answer: string) {
  const trimmed = answer.trim();
  if (!trimmed) return true;
  return trimmed.length <= INSUFFICIENT_MARKER.length + 12 && trimmed.includes(INSUFFICIENT_MARKER);
}
