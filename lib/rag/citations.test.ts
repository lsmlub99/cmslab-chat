import { describe, expect, it } from "vitest";
import { selectReferencedItems, selectUsedCitations, stripCitationReferences } from "./citations";

const citations = [
  { id: 1, title: "복리후생", sourceUrl: "https://example.com/benefits", page: 1 },
  { id: 2, title: "인사행정 Q&A" },
  { id: 3, title: "복리후생", sourceUrl: "https://example.com/benefits", page: 2 },
];

describe("selectUsedCitations", () => {
  it("keeps only cited sources and collapses chunks from the same document", () => {
    expect(selectUsedCitations("안내입니다. [출처 1], [출처 3]", citations)).toEqual([
      citations[0],
    ]);
  });

  it("falls back to all unique sources when the model omits references", () => {
    expect(selectUsedCitations("안내입니다.", citations)).toEqual([
      citations[0],
      citations[1],
    ]);
  });
});

describe("selectReferencedItems", () => {
  it("preserves all referenced chunks so links can be collected before document deduplication", () => {
    expect(selectReferencedItems("[출처 1], [출처 3]", citations)).toEqual([
      citations[0],
      citations[2],
    ]);
  });
});

describe("stripCitationReferences", () => {
  it("removes model citation markers without damaging the answer", () => {
    expect(stripCitationReferences("아래 링크에서 확인하세요. [출처 1], [출처 3]"))
      .toBe("아래 링크에서 확인하세요.");
  });
});
