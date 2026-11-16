import { describe, expect, it } from "vitest";
import { buildSearchQuery, HISTORY_TURNS } from "./conversation-context";

describe("conversation context", () => {
  it("keeps enough recent turns for multi-step follow-up questions", () => {
    expect(HISTORY_TURNS).toBe(6);
    const query = buildSearchQuery("그럼 신청은 어떻게 해?", [
      { question: "부모님이 돌아가시면 어떤 지원이 있어?", answer: "경조금과 휴가를 지원합니다." },
      { question: "휴가는 며칠이야?", answer: "5일입니다." },
    ]);
    expect(query).toContain("부모님이 돌아가시면");
    expect(query).toContain("휴가는 며칠이야");
    expect(query).toContain("그럼 신청은 어떻게 해");
  });

  it("does not prepend old context to a clearly independent long question", () => {
    const question = "업무용 차량을 처음 이용하는 절차를 자세히 알려줘";
    expect(buildSearchQuery(question, [
      { question: "연차는 며칠이야?", answer: "근속연수에 따라 다릅니다." },
    ])).toBe(question);
  });
});
