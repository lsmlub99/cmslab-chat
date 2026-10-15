import { describe, expect, it } from "vitest";
import { formatSlackAnswer } from "./format";

describe("formatSlackAnswer", () => {
  it("formats citations for Slack and rejects unsafe source URLs", () => {
    const text = formatSlackAnswer({
      status: "answered",
      answer: "답변입니다.",
      questionId: 1,
      conversationId: "conversation",
      responseMs: 10,
      links: [],
      citations: [
        { id: 1, title: "규정 | 문서", sourceUrl: "https://example.com/policy", page: 2 },
        { id: 2, title: "위험 <문서>", sourceUrl: "javascript:alert(1)" },
      ],
    });

    expect(text).toContain("<https://example.com/policy|규정 - 문서> (2쪽)");
    expect(text).toContain("위험 &lt;문서&gt;");
    expect(text).not.toContain("javascript:");
  });
});
