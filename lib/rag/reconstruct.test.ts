import { describe, expect, it } from "vitest";
import { reconstructDocument } from "./reconstruct";

describe("reconstructDocument", () => {
  it("청크 사이의 정확한 겹침을 한 번만 남긴다", () => {
    const overlap = "가".repeat(80);
    expect(reconstructDocument([`첫 문단 ${overlap}`, `${overlap} 둘째 문단`]))
      .toBe(`첫 문단 ${overlap} 둘째 문단`);
  });

  it("겹치지 않는 청크는 문단으로 이어 붙인다", () => {
    expect(reconstructDocument(["첫째", "둘째"])).toBe("첫째\n\n둘째");
  });

  it("완전히 중복된 청크는 제거한다", () => {
    expect(reconstructDocument(["같은 내용", "같은 내용"])).toBe("같은 내용");
  });
});

