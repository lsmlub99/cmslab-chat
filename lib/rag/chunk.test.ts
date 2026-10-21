import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("returns no chunks for empty input", () => expect(chunkText(" ")).toEqual([]));

  it("preserves markdown headings as section metadata", () => {
    const result = chunkText("## 온보딩\n\n첫날 계정 발급을 진행합니다.\n\n첫 주에는 필수 교육을 진행합니다.");
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].section).toBe("온보딩");
  });

  it("splits long paragraphs into multiple chunks", () => {
    const result = chunkText(Array.from(
      { length: 180 },
      (_, index) => `문서 문장 ${index}. 업무 규칙과 절차를 설명합니다.`,
    ).join(" "));
    expect(result.length).toBeGreaterThan(1);
  });

  it("separates line-oriented Q/A entries even without blank lines", () => {
    const result = chunkText([
      "연차",
      "Q. 연차는 언제 생기나요?",
      "A. 입사일을 기준으로 발생합니다.",
      "근거: 취업규칙 제1조",
      "Q. 어디에서 신청하나요?",
      "A. 인사 시스템에서 신청합니다.",
    ].join("\n"));

    expect(result).toHaveLength(2);
    expect(result[0].section).toContain("연차");
    expect(result[0].content).toContain("언제 생기나요");
    expect(result[0].content).not.toContain("어디에서 신청하나요");
    expect(result[1].content).toContain("어디에서 신청하나요");
  });

  it("keeps different policy headings attached to their own Q/A", () => {
    const result = chunkText([
      "연차",
      "Q. 휴가는 어떻게 사용하나요?",
      "A. 사전 승인을 받습니다.",
      "경조사",
      "Q. 할아버지가 돌아가셨어요.",
      "A. 경조휴가를 신청할 수 있습니다.",
    ].join("\n"));

    expect(result).toHaveLength(2);
    expect(result[0].section).toContain("연차");
    expect(result[1].section).toContain("경조사");
  });
});
