import { describe, expect, it } from "vitest";
import { answerCompanySupportQuestion } from "./company-support";

describe("answerCompanySupportQuestion", () => {
  it("links the company rules folder and routes questions to People&Culture", () => {
    const result = answerCompanySupportQuestion("사내 전체 규정은 어디서 봐?");
    expect(result?.answer).toContain("피플앤컬처팀");
    expect(result?.links[0]?.url).toContain("1KrUtrge9wv5RsVWrtEZPsKNn4ohFW64V");
  });

  it("does not invent an address or parking process while the office move is pending", () => {
    expect(answerCompanySupportQuestion("회사 주소가 어디야?")?.answer).toContain("강남역");
    expect(answerCompanySupportQuestion("방문차량 주차 정산은 어디서 해?")?.answer).toContain("이전 예정");
  });

  it("routes purchasing to SCM and keeps the confirmed substitute-leave rule", () => {
    expect(answerCompanySupportQuestion("발주 프로세스가 어떻게 돼?")?.answer).toContain("SCM팀");
    expect(answerCompanySupportQuestion("주말 근무 대휴는 어떻게 계산해?")?.answer).toContain("1.5배");
  });

  it("routes club and parental-leave application details to People&Culture", () => {
    expect(answerCompanySupportQuestion("동호회를 새로 만들려면 어떻게 해?")?.answer).toContain("피플앤컬처팀");
    expect(answerCompanySupportQuestion("육아휴직 신청 서류 알려줘")?.answer).toContain("피플앤컬처팀");
  });

  it("leaves unrelated questions to the regular RAG flow", () => {
    expect(answerCompanySupportQuestion("우리 회사 브랜드가 뭐야?")).toBeNull();
  });
});
