import { describe, expect, it } from "vitest";
import { suggestTeam } from "./team-routing-model";

const teams = [
  "SCM팀", "재경팀", "People&Culture팀", "연구개발팀", "메디컬팀",
  "디자인팀", "브랜드 비주얼팀", "경영관리팀", "기획실", "중국사업팀", "일본사업팀",
];

describe("suggestTeam", () => {
  it("routes purchasing and accounting questions to different teams", () => {
    expect(suggestTeam("원부자재 발주는 누구에게 물어봐?", teams)?.team).toBe("SCM팀");
    expect(suggestTeam("전표 마감 기준이 궁금해", teams)?.team).toBe("재경팀");
  });

  it("routes HR and IT questions to People&Culture contacts", () => {
    expect(suggestTeam("휴직 서류를 모르겠어", teams)?.contact).toBe("People&Culture팀");
    expect(suggestTeam("노트북 계정 오류가 나", teams)?.contact).toBe("People&Culture팀 IT 담당");
  });

  it("uses an explicitly named organization and avoids guessing unknown topics", () => {
    expect(suggestTeam("SCM팀의 새로운 프로세스 알려줘", teams)?.team).toBe("SCM팀");
    expect(suggestTeam("오늘 날씨 어때?", teams)).toBeNull();
  });

  it("never suggests a mapped team that is absent from the current directory", () => {
    expect(suggestTeam("전표 마감 기준이 궁금해", ["SCM팀"])).toBeNull();
  });
});
