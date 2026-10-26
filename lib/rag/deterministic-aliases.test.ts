import { describe, expect, it } from "vitest";
import { deterministicSearchAliases, mergeSearchAliases } from "./deterministic-aliases";

describe("deterministicSearchAliases", () => {
  it("covers conversational vehicle-rental wording", () => {
    const aliases = deterministicSearchAliases({
      title: "차량 대여",
      content: "업무용 쏘카 사용 설명서",
    });
    expect(aliases).toContain("업무용 차는 어떻게 빌려");
    expect(aliases).toContain("쏘카 사용 방법");
  });

  it("covers employee parking registration wording", () => {
    const aliases = deterministicSearchAliases({ title: "주차 등록 사이트 안내해줘" });
    expect(aliases).toContain("직원 주차 신청 어디서 해");
    expect(aliases).toContain("주차 등록 방법");
  });

  it("keeps generated aliases and supplies a fallback for unknown topics", () => {
    const fallback = deterministicSearchAliases({ title: "새로운 사내 제도" });
    expect(mergeSearchAliases(["직원이 물어볼 표현"], fallback)).toEqual(expect.arrayContaining([
      "직원이 물어볼 표현",
      "새로운 사내 제도 알려줘",
    ]));
  });
});
