import { describe, expect, it } from "vitest";
import { expandQueryTerms } from "./synonyms";

describe("vehicle and parking query expansion", () => {
  it("maps conversational vehicle-rental wording to the canonical topic", () => {
    expect(expandQueryTerms("업무용 차는 어떻게 빌려?", ["업무용", "차는", "빌려"]))
      .toEqual(expect.arrayContaining(["차량 대여", "쏘카", "렌터카"]));
  });

  it("adds parking registration intent terms", () => {
    expect(expandQueryTerms("직원 주차 신청 어디서 해?", ["직원", "주차", "신청"]))
      .toEqual(expect.arrayContaining(["주차 등록", "주차 사이트"]));
  });
});
