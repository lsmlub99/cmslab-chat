import { chatModel, openai } from "@/lib/openai";

/**
 * 모델로 질문의 동의어를 넓힙니다.
 *
 * 동의어 사전(lib/rag/synonyms.ts)이 먼저 처리하고, 그래도 근거를 못 찾았을 때만
 * 여기까지 옵니다. 사전에 없는 낱말을 위한 마지막 시도입니다.
 *
 * 실측: 사전만으로 못 찾던 표현들을 모델 확장으로 다시 검색하면
 * 6건 중 5건이 정답 문서를 1위로 끌어올렸습니다.
 * 다만 호출이 하나 더 붙으므로(약 0.5초) 매 질문마다 쓰지는 않습니다.
 */
export async function expandQuestion(question: string): Promise<string> {
  try {
    const response = await openai().responses.create({
      model: chatModel(),
      instructions: `사내 지식 검색용으로 질문을 확장합니다.
질문에 담긴 개념의 한국어 동의어와 사내에서 쓸 법한 정식 명칭을 나열하세요.
설명 없이 검색어만 공백으로 구분해 한 줄로 출력합니다. 최대 12개 낱말.
예) "휴가 며칠 써요?" -> 휴가 연차 연차휴가 월차 유급휴가 휴가일수 연차일수`,
      input: question,
      max_output_tokens: 100,
    });

    const text = response.output_text?.trim() ?? "";
    // 모델이 문장으로 답하면 검색어로 쓰기에 부적합하므로 버립니다.
    if (!text || text.length > 200) return "";
    return text;
  } catch {
    // 확장은 어디까지나 보조 수단입니다. 실패해도 검색 자체는 이미 끝나 있습니다.
    return "";
  }
}
