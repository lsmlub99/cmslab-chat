import { describe, expect, it } from "vitest";
import {
  formatOrgHeadcountAnswer,
  isSharedDirectoryAccountName,
  isOrgHeadcountQuestion,
  mergeOrgUnits,
  organizationAliases,
  orgDirectorySyncSchema,
  summarizeDirectoryMembers,
} from "./org-directory-model";

const snapshot = {
  snapshotAt: "2026-11-16T03:13:27.000Z",
  totalActive: 10,
  orgUnits: [
    { path: "/대표이사/마케팅 Group/GMC", count: 3 },
    { path: "/대표이사/마케팅 Group/브랜드 비주얼팀", count: 2 },
    { path: "/대표이사/전략기획실/SCM팀", count: 5 },
  ],
};

const aliasSnapshot = {
  snapshotAt: "2026-11-16T03:13:27.000Z",
  totalActive: 15,
  orgUnits: [
    { path: "/대표이사/People&Culture실", count: 4 },
    { path: "/대표이사/마케팅 Group/MC팀", count: 3 },
    { path: "/대표이사/마케팅 Group/BM팀", count: 2 },
    { path: "/대표이사/마케팅 Group/GMC", count: 2 },
    { path: "/대표이사/Expert BU/RDBD1팀", count: 2 },
    { path: "/대표이사/연구실/연구개발팀", count: 2 },
  ],
};

describe("org directory model", () => {
  it("recognizes total and follow-up headcount questions", () => {
    expect(isOrgHeadcountQuestion("우리 회사 몇 명이야?")).toBe(true);
    expect(isOrgHeadcountQuestion("그럼 SCM팀은?", "전체 활성 인원은 10명입니다.")).toBe(true);
    expect(isOrgHeadcountQuestion("회사 주소 알려줘")).toBe(false);
  });

  it("answers a specific team and aggregates a parent organization", () => {
    expect(formatOrgHeadcountAnswer("SCM팀 몇 명이야?", snapshot)).toContain("SCM팀 활성 인원은 5명");
    expect(formatOrgHeadcountAnswer("SCM 몇명이고?", snapshot)).toContain("SCM팀 활성 인원은 5명");
    expect(formatOrgHeadcountAnswer("마케팅 Group 인원은?", snapshot)).toContain("마케팅 Group 활성 인원은 5명");
  });

  it("recognizes English organization abbreviations, Korean pronunciations, and common nicknames", () => {
    expect(organizationAliases("People&Culture실")).toContain("피컬");
    expect(organizationAliases("DX팀")).toContain("디엑스");
    expect(organizationAliases("Marketing Communication팀")).toContain("엠씨");
    expect(formatOrgHeadcountAnswer("피컬 몇 명이야?", aliasSnapshot)).toContain("People&Culture실 활성 인원은 4명");
    expect(formatOrgHeadcountAnswer("인사팀 인원은?", aliasSnapshot)).toContain("People&Culture실 활성 인원은 4명");
    expect(formatOrgHeadcountAnswer("피플앤컬처는 몇 명?", aliasSnapshot)).toContain("People&Culture실 활성 인원은 4명");
    expect(formatOrgHeadcountAnswer("엠씨는 몇명?", aliasSnapshot)).toContain("MC팀 활성 인원은 3명");
    expect(formatOrgHeadcountAnswer("비엠은 몇명?", aliasSnapshot)).toContain("BM팀 활성 인원은 2명");
    expect(formatOrgHeadcountAnswer("지엠씨 몇 명이고?", aliasSnapshot)).toContain("GMC 활성 인원은 2명");
    expect(formatOrgHeadcountAnswer("알디비디1 몇 명이야?", aliasSnapshot)).toContain("RDBD1팀 활성 인원은 2명");
    expect(formatOrgHeadcountAnswer("알앤디 몇 명?", aliasSnapshot)).toContain("연구개발팀 활성 인원은 2명");
  });

  it("answers total and organization summaries", () => {
    expect(formatOrgHeadcountAnswer("우리 회사 몇 명이야?", snapshot)).toContain("전체 활성 인원은 10명");
    const answer = formatOrgHeadcountAnswer("부서별 인원 현황 알려줘", snapshot);
    expect(answer).toContain("마케팅 Group 5명");
    expect(answer).toContain("전략기획실 5명");
  });

  it("merges duplicate paths and validates the sync payload", () => {
    expect(mergeOrgUnits([{ path: "대표이사/SCM팀/", count: 2 }, { path: "/대표이사/SCM팀", count: 3 }]))
      .toEqual([{ path: "/대표이사/SCM팀", count: 5 }]);
    expect(orgDirectorySyncSchema.safeParse({
      snapshotMonth: "2026-11-01",
      snapshotAt: "2026-11-16T03:13:27.000Z",
      totalActive: 5,
      orgUnits: [{ path: "/대표이사/SCM팀", count: 5 }],
    }).success).toBe(true);
  });

  it("excludes shared accounts by display name without excluding a real employee", () => {
    for (const name of ["S C", "Team SCM", "셀퓨전씨글로벌마케팅", "플랫폼대표 계정", "더마블록", "위시켓"]) {
      expect(isSharedDirectoryAccountName(name)).toBe(true);
    }
    expect(isSharedDirectoryAccountName("에블리나")).toBe(false);
    expect(isSharedDirectoryAccountName("피니(fenny)")).toBe(false);

    expect(summarizeDirectoryMembers([
      { displayName: "Team SCM", path: "/대표이사/전략기획실/SCM팀" },
      { displayName: "에블리나", path: "/대표이사/마케팅 Group/GMC" },
      { displayName: "앤(강예은)", path: "/대표이사/동북아 BU/일본사업팀" },
    ])).toEqual({
      totalActive: 2,
      orgUnits: [
        { path: "/대표이사/마케팅 Group/GMC", count: 1 },
        { path: "/대표이사/동북아 BU/일본사업팀", count: 1 },
      ],
      excludedAccountCount: 1,
    });
  });
});
