import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("returns no chunks for empty input", () => expect(chunkText(" ")).toEqual([]));
  it("preserves headings as section metadata", () => { const result = chunkText("## 온보딩\n\n첫날 계정 발급을 진행합니다.\n\n첫 주에는 필수 교육을 진행합니다."); expect(result.length).toBeGreaterThan(0); expect(result[0].section).toBe("온보딩"); });
  it("splits long paragraphs into multiple chunks", () => { const result = chunkText(Array.from({ length: 180 }, (_, i) => `문서 문장 ${i} 팀의 업무 규칙과 절차를 설명합니다.`).join(" ")); expect(result.length).toBeGreaterThan(1); });
  it("일반 문서의 짧은 첫 줄도 섹션 제목으로 인식한다", () => {
    const result = chunkText("연차\n연차는 입사일을 기준으로 발생합니다.\n\n임금\n급여일은 매월 지정일입니다.");
    expect(result.map(chunk => chunk.section)).toEqual(["연차", "임금"]);
  });
  it("서로 다른 Q&A를 별도 섹션으로 나눈다", () => {
    const result = chunkText("Q. 연차는 언제 생기나요?\nA. 입사일을 기준으로 발생합니다.\n\nQ. 어디에서 신청하나요?\nA. 인사 시스템에서 신청합니다.");
    expect(result).toHaveLength(2);
    expect(result[0].section).toBe("Q. 연차는 언제 생기나요?");
    expect(result[1].section).toBe("Q. 어디에서 신청하나요?");
  });
});
