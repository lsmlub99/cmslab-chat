import { describe, expect, it } from "vitest";
import { answerHrCalculator } from "./hr-calculators";

describe("answerHrCalculator", () => {
  it("ignores unrelated questions", () => {
    expect(answerHrCalculator("점심시간 알려줘")).toBeNull();
  });

  it("asks for completed service years before calculating annual leave", () => {
    const result = answerHrCalculator("연차 계산해줘");
    expect(result?.kind).toBe("annual_leave");
    expect(result?.phase).toBe("prompt");
    expect(result?.answer).toContain("만 근속연수");
  });

  it("calculates annual leave from completed years", () => {
    const result = answerHrCalculator("만 3년", [
      { question: "연차 계산해줘", answer: "입사일부터 오늘까지 꽉 채운 만 근속연수를 알려주세요." },
    ]);
    expect(result?.phase).toBe("result");
    expect(result?.answer).toContain("16일");
  });

  it("calculates first-year leave from completed months", () => {
    const result = answerHrCalculator("만 0년, 개근 8개월", [
      { question: "연차 계산해줘", answer: "입사일부터 오늘까지 꽉 채운 만 근속연수를 알려주세요." },
    ]);
    expect(result?.answer).toContain("8일");
  });

  it("asks for the statutory severance inputs", () => {
    const result = answerHrCalculator("퇴직금 계산해줘");
    expect(result?.kind).toBe("severance");
    expect(result?.phase).toBe("prompt");
    expect(result?.answer).toContain("3개월 세전 임금총액");
    expect(result?.answer).toContain("고용노동부");
  });

  it("calculates a severance estimate with bonuses and leave pay", () => {
    const result = answerHrCalculator(
      "입사일 2014-10-02, 퇴직일 2017-09-16, 3개월 임금총액 708만원, 상여금 400만원, 연차수당 30만원, 통상일급 모름",
      [{ question: "퇴직금 계산해줘", answer: "퇴직금 예상액을 계산하려면 아래 값을 알려주세요." }],
    );
    expect(result?.phase).toBe("result");
    expect(result?.answer).toContain("1,080일");
    expect(result?.answer).toContain("92일");
    expect(result?.answer).toContain("88,641원");
    expect(result?.answer).toContain("1일 통상임금은 입력되지 않아");
  });

  it("accepts the last working day and applies the following day as retirement date", () => {
    const result = answerHrCalculator(
      "입사일 2022-01-03, 마지막 근무일 2026-11-30, 3개월 임금총액 1,200만원, 상여금 없음, 연차수당 없음, 통상일급 모름",
      [{ question: "퇴직금 계산해줘", answer: "퇴직금 예상액을 계산하려면 아래 값을 알려주세요." }],
    );
    expect(result?.phase).toBe("result");
    expect(result?.answer).toContain("1일 통상임금은 입력되지 않아");
  });
});
