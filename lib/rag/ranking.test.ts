import { describe, expect, it } from "vitest";
import { governanceRankBoost, metadataKeywordHits, searchRankScore } from "./ranking";

describe("검색 결과 재정렬", () => {
  it("질문 핵심어가 문서 제목에 있으면 가산한다", () => {
    expect(metadataKeywordHits({ title: "복리후생" }, ["복리후생", "휴가"]))
      .toEqual({ title: 1, section: 0, aliases: 0 });
  });

  it("유사도가 조금 낮아도 제목이 정확한 문서를 일반 Q&A보다 우선한다", () => {
    const direct = searchRankScore({
      similarity: 0.29,
      keywordHits: 1,
      metadata: { title: "복리후생" },
    }, ["복리후생"]);
    const pointer = searchRankScore({
      similarity: 0.32,
      keywordHits: 1,
      metadata: { title: "인사행정_Q&A" },
    }, ["복리후생"]);

    expect(direct).toBeGreaterThan(pointer);
  });

  it("섹션 제목의 직접 일치도 본문 검색을 보완한다", () => {
    const exactSection = searchRankScore({
      similarity: 0.3,
      keywordHits: 1,
      metadata: { title: "인사행정_Q&A", section: "연차" },
    }, ["연차"]);
    const generic = searchRankScore({
      similarity: 0.32,
      keywordHits: 1,
      metadata: { title: "인사행정_Q&A", section: "임금" },
    }, ["연차"]);

    expect(exactSection).toBeGreaterThan(generic);
  });

  it("검색 별칭의 표현 일치를 반영한다", () => {
    expect(metadataKeywordHits({ search_aliases: ["할아버지가 돌아가셨어요", "조부상 휴가"] }, ["할아버지"]))
      .toEqual({ title: 0, section: 0, aliases: 1 });
  });

  it("공식 문서는 우대하고 만료 문서는 낮춘다", () => {
    expect(governanceRankBoost({ authority: "official", priority: 80 }, new Date("2026-10-21"))).toBeGreaterThan(0);
    expect(governanceRankBoost({ authority: "official", expires_at: "2025-01-01" }, new Date("2026-10-21"))).toBe(-0.2);
  });
});
