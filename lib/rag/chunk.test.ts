import { describe, expect, it } from "vitest";
import { chunkText } from "./chunk";

describe("chunkText", () => {
  it("returns no chunks for empty input", () => expect(chunkText(" ")).toEqual([]));
  it("preserves headings as section metadata", () => { const result = chunkText("## 온보딩\n\n첫날 계정 발급을 진행합니다.\n\n첫 주에는 필수 교육을 진행합니다."); expect(result.length).toBeGreaterThan(0); expect(result[0].section).toBe("온보딩"); });
  it("splits long paragraphs into multiple chunks", () => { const result = chunkText(Array.from({ length: 180 }, (_, i) => `문서 문장 ${i} 팀의 업무 규칙과 절차를 설명합니다.`).join(" ")); expect(result.length).toBeGreaterThan(1); });
});
