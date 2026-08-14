import { describe, expect, it } from "vitest";
import { createStreamSanitizer, sanitizeAnswer } from "./sanitize";

describe("sanitizeAnswer", () => {
  it("둥근 따옴표를 곧은 따옴표로 바꾼다", () => {
    expect(sanitizeAnswer("“피부 미용” 제품")).toBe('"피부 미용" 제품');
    expect(sanitizeAnswer("‘연차’")).toBe("'연차'");
  });

  it("마크다운 강조 기호를 걷어내고 내용은 남긴다", () => {
    expect(sanitizeAnswer("연차는 **15일**입니다.")).toBe("연차는 15일입니다.");
    expect(sanitizeAnswer("__밑줄__ 표시")).toBe("밑줄 표시");
    expect(sanitizeAnswer("경로는 `그룹웨어`입니다.")).toBe("경로는 그룹웨어입니다.");
  });

  it("곱셈이나 각주로 쓰인 별표는 건드리지 않는다", () => {
    expect(sanitizeAnswer("2 * 3 = 6")).toBe("2 * 3 = 6");
  });

  it("제목·인용 기호를 제거한다", () => {
    expect(sanitizeAnswer("## 연차 안내")).toBe("연차 안내");
    expect(sanitizeAnswer("> 인용문")).toBe("인용문");
  });

  it("깨진 문자와 폭 없는 공백을 지운다", () => {
    expect(sanitizeAnswer("연차� 신청​")).toBe("연차 신청");
  });

  it("불릿을 하이픈으로 통일한다", () => {
    expect(sanitizeAnswer("* 첫째\n+ 둘째")).toBe("- 첫째\n- 둘째");
  });

  it("빈 줄이 과하게 늘어나지 않는다", () => {
    expect(sanitizeAnswer("가\n\n\n\n나")).toBe("가\n\n나");
  });
});

describe("createStreamSanitizer", () => {
  it("조각을 이어 붙인 결과가 한 번에 정리한 것과 같다", () => {
    const sanitizer = createStreamSanitizer();
    const parts = ["연차는 ", "**15", "일**", "입니다."];
    let shown = parts.map(part => sanitizer.push(part)).join("");
    const { text, tail, replace } = sanitizer.finish();
    shown = replace ? text : shown + tail;
    expect(shown).toBe("연차는 15일입니다.");
  });

  it("조각 경계에 걸친 둥근 따옴표도 처리한다", () => {
    const sanitizer = createStreamSanitizer();
    let shown = ["제품은 ", "“피부", " 미용” 용도", "입니다."].map(part => sanitizer.push(part)).join("");
    const { text, tail, replace } = sanitizer.finish();
    shown = replace ? text : shown + tail;
    expect(shown).toBe('제품은 "피부 미용" 용도입니다.');
  });

  it("이미 보낸 내용을 다시 보내지 않는다", () => {
    const sanitizer = createStreamSanitizer();
    expect(sanitizer.push("가나")).toBe("가나");
    expect(sanitizer.push("다라")).toBe("다라");
  });

  it("서식이 없는 평문은 그대로 흘려보낸다", () => {
    const sanitizer = createStreamSanitizer();
    const parts = ["연차 신청은 ", "그룹웨어에서 ", "진행합니다."];
    const shown = parts.map(part => sanitizer.push(part)).join("");
    expect(shown).toBe("연차 신청은 그룹웨어에서 진행합니다.");
    expect(sanitizer.finish().text).toBe("연차 신청은 그룹웨어에서 진행합니다.");
  });
});
