import { describe, expect, it } from "vitest";
import { expandForEmbedding, expandTerms, synonymCount } from "./synonyms";

describe("동의어 사전", () => {
  it("사전에 낱말이 등록되어 있다", () => {
    expect(synonymCount()).toBeGreaterThan(100);
  });

  it("휴가로 물으면 연차·월차가 함께 검색된다", () => {
    const terms = expandTerms(["휴가"]);
    expect(terms).toContain("연차");
    expect(terms).toContain("월차");
  });

  it("반대 방향도 동작한다", () => {
    expect(expandTerms(["연차"])).toContain("휴가");
  });

  it("부의금으로 경조사 낱말이 붙는다", () => {
    const terms = expandTerms(["부의금"]);
    expect(terms).toContain("경조사");
    expect(terms).toContain("조의금");
  });

  it("랩탑으로 노트북이 붙는다", () => {
    expect(expandTerms(["랩탑"])).toContain("노트북");
  });

  it("영문 표기도 찾는다", () => {
    expect(expandTerms(["WiFi"])).toContain("와이파이");
  });

  it("원래 낱말이 앞에 남는다", () => {
    const terms = expandTerms(["부의금", "지원"]);
    expect(terms[0]).toBe("부의금");
    expect(terms[1]).toBe("지원");
  });

  it("사전에 없는 낱말은 그대로 둔다", () => {
    expect(expandTerms(["리페라"])).toEqual(["리페라"]);
  });

  it("중복을 만들지 않는다", () => {
    const terms = expandTerms(["휴가", "연차"]);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("상한을 넘지 않는다", () => {
    expect(expandTerms(["휴가", "경조사", "노트북"], 8).length).toBeLessThanOrEqual(8);
  });

  it("임베딩 문장은 원문으로 시작한다", () => {
    const question = "휴가 며칠 쓸 수 있어요?";
    expect(expandForEmbedding(question, ["휴가"]).startsWith(question)).toBe(true);
  });

  it("확장할 게 없으면 원문 그대로다", () => {
    expect(expandForEmbedding("리페라 사용법", ["리페라"])).toBe("리페라 사용법");
  });
});
