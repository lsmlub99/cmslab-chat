import { describe, expect, it } from "vitest";
import { parseAliases } from "./aliases-parser";

describe("parseAliases", () => {
  it("청크별 질문 표현을 제한하고 중복 제거한다", () => {
    const result = parseAliases("0\t연차 며칠이야 | 휴가 일수 | 연차 며칠이야\n[1]\t할아버지가 돌아가셨어요 | 조부상 휴가", 2);
    expect(result).toEqual([
      ["연차 며칠이야", "휴가 일수"],
      ["할아버지가 돌아가셨어요", "조부상 휴가"],
    ]);
  });

  it("잘못된 형식과 범위를 무시한다", () => {
    expect(parseAliases("답변입니다\n9\t범위 밖", 1)).toEqual([[]]);
  });
});
