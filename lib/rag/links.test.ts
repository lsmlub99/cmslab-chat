import { describe, expect, it } from "vitest";
import { splitLinks } from "./links";

describe("splitLinks", () => {
  it("링크가 없으면 통째로 하나의 조각이다", () => {
    expect(splitLinks("연차는 15일입니다.")).toEqual([{ text: "연차는 15일입니다." }]);
  });

  it("URL을 링크 조각으로 분리한다", () => {
    const pieces = splitLinks("가이드: https://docs.google.com/spreadsheets/d/abc 확인하세요");
    expect(pieces[1]).toEqual({
      text: "https://docs.google.com/spreadsheets/d/abc",
      href: "https://docs.google.com/spreadsheets/d/abc",
    });
  });

  it("URL 뒤의 문장부호는 링크에 포함하지 않는다", () => {
    const link = splitLinks("자세한 내용은 https://example.com/guide 입니다.").find(p => p.href);
    expect(link?.href).toBe("https://example.com/guide");
  });

  it("괄호나 마침표로 끝나도 주소만 링크로 잡는다", () => {
    const link = splitLinks("(https://example.com/a).").find(p => p.href);
    expect(link?.href).toBe("https://example.com/a");
  });

  it("여러 링크를 모두 처리한다", () => {
    const links = splitLinks("https://a.com 과 https://b.com").filter(p => p.href);
    expect(links.map(p => p.href)).toEqual(["https://a.com", "https://b.com"]);
  });

  it("쿼리 문자열이 붙은 주소도 온전히 잡는다", () => {
    const link = splitLinks("https://docs.google.com/x?a=1&b=2 를 보세요").find(p => p.href);
    expect(link?.href).toBe("https://docs.google.com/x?a=1&b=2");
  });

  it("조각을 다시 이으면 원문과 같다", () => {
    const input = "경조 가이드 https://docs.google.com/x?a=1&b=2 를 보세요. 끝.";
    expect(splitLinks(input).map(p => p.text).join("")).toBe(input);
  });
});
