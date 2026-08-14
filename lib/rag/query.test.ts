import { describe, expect, it } from "vitest";
import { ftsQuery, keywordTerms, stripParticle } from "./query";

describe("stripParticle", () => {
  it("떼어낼 조사가 없으면 원본을 유지한다", () => {
    expect(stripParticle("연차")).toBe("연차");
    expect(stripParticle("노트북")).toBe("노트북");
  });

  it("한국어 조사를 떼어낸다", () => {
    expect(stripParticle("연차를")).toBe("연차");
    expect(stripParticle("경조사는")).toBe("경조사");
    expect(stripParticle("그룹웨어에서")).toBe("그룹웨어");
  });

  it("어간이 한 글자만 남을 만큼 짧으면 떼어내지 않는다", () => {
    expect(stripParticle("나는")).toBe("나는");
  });

  it("한글이 아닌 토큰은 건드리지 않는다", () => {
    expect(stripParticle("Workday")).toBe("Workday");
    expect(stripParticle("CMS_GUEST_WIFI")).toBe("CMS_GUEST_WIFI");
  });
});

describe("keywordTerms", () => {
  it("원형과 조사를 뗀 어간을 모두 포함한다", () => {
    const terms = keywordTerms("연차를 어떻게 신청해?");
    expect(terms).toContain("연차를");
    expect(terms).toContain("연차");
  });

  it("질문을 만드는 군더더기는 제외한다", () => {
    const terms = keywordTerms("경조사 지원금 신청 방법 알려줘");
    expect(terms).toContain("경조사");
    expect(terms).toContain("지원금");
    expect(terms).not.toContain("알려줘");
  });

  it("구두점을 지우고 한 글자 토큰은 버린다", () => {
    expect(keywordTerms("리페라, 세제?!")).toEqual(expect.arrayContaining(["리페라", "세제"]));
    expect(keywordTerms("a 연차")).not.toContain("a");
  });

  it("중복 없이 상한 개수까지만 돌려준다", () => {
    const terms = keywordTerms("연차 연차 연차 휴가 휴가", 3);
    expect(terms.length).toBeLessThanOrEqual(3);
    expect(new Set(terms).size).toBe(terms.length);
  });

  it("검색어가 하나도 안 남으면 빈 배열이다", () => {
    expect(keywordTerms("어떻게 알려줘")).toEqual([]);
  });
});

describe("ftsQuery", () => {
  it("키워드를 공백으로 이어 붙인다", () => {
    expect(ftsQuery("연차 신청")).toContain("연차");
  });

  it("키워드가 없으면 원문으로 되돌아간다", () => {
    expect(ftsQuery("어떻게")).toBe("어떻게");
  });
});
