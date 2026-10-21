import { describe, expect, it } from "vitest";
import { expandForEmbedding, expandQueryTerms, expandTerms, synonymCount } from "./synonyms";

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

  it.each([
    ["연차관련 내용도 알려줘", "연차"],
    ["월차는 어떻게 돼요?", "연차휴가"],
    ["휴가는 며칠 쓸 수 있어요?", "연차"],
    ["이번 주에 하루 쉬고 싶어요", "연차"],
  ])("휴가 표현 %s를 표준 용어로 확장한다", (question, expected) => {
    expect(expandQueryTerms(question, [], 32)).toContain(expected);
  });

  it.each([
    ["할아버지가 돌아가셨어요", "조부모 사망"],
    ["조모상을 당했습니다", "조부모 사망"],
    ["외할머니 부고를 받았어요", "본인 외조부모"],
    ["할아버님이 별세하셨습니다", "조부모 사망"],
    ["아버지가 별세하셨습니다", "부모 사망"],
    ["장모님이 돌아가셨어요", "부모 사망"],
    ["남편 장례에는 며칠 쉴 수 있나요", "배우자 사망"],
    ["형이 사망했어요", "형제자매 사망"],
  ])("사망 상황 %s를 경조사 기준 용어로 확장한다", (question, expected) => {
    const terms = expandQueryTerms(question, [], 32);
    expect(terms).toContain("경조사");
    expect(terms).toContain(expected);
  });

  it.each([
    ["아들이 결혼해요", "자녀 결혼"],
    ["우리 딸이 시집가요", "자녀 결혼"],
    ["누나가 결혼합니다", "형제자매 결혼"],
    ["제가 결혼하는데 지원이 있나요", "본인 결혼"],
  ])("결혼 상황 %s를 경조사 기준 용어로 확장한다", (question, expected) => {
    const terms = expandQueryTerms(question, [], 32);
    expect(terms).toContain("경조사");
    expect(terms).toContain(expected);
  });

  it("사건 표현이 없으면 가족 호칭만으로 경조사로 오해하지 않는다", () => {
    expect(expandQueryTerms("할아버지 건강검진", [], 32)).not.toContain("조부모 사망");
  });

  it("배우자의 조부모상과 본인의 조부모상을 구분한다", () => {
    const terms = expandQueryTerms("남편 할아버지가 돌아가셨어요", [], 32);
    expect(terms).toContain("배우자 조부모 사망");
    expect(terms).not.toContain("본인 외조부모");
    expect(terms).not.toContain("배우자 사망");
  });
});
