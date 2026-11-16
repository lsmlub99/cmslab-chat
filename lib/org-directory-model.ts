import { z } from "zod";

export type OrgUnitCount = { path: string; count: number };
export type OrgDirectoryMember = { displayName: string; path: string };
export type OrgDirectorySnapshot = {
  snapshotAt: string;
  totalActive: number;
  orgUnits: OrgUnitCount[];
};

export const orgDirectorySyncSchema = z.object({
  snapshotMonth: z.string().regex(/^\d{4}-\d{2}-01$/),
  snapshotAt: z.string().datetime({ offset: true }),
  totalActive: z.number().int().min(0).max(100_000),
  orgUnits: z.array(z.object({
    path: z.string().trim().min(1).max(500),
    count: z.number().int().min(0).max(100_000),
  })).max(1_000),
  members: z.array(z.object({
    displayName: z.string().trim().min(1).max(200),
    path: z.string().trim().min(1).max(500),
  })).max(5_000).optional(),
});

const SHARED_ACCOUNT_NAMES = new Set([
  "sc",
  "teamscm",
  "셀퓨전씨글로벌마케팅",
  "플랫폼대표계정",
  "셀퓨전씨마케팅",
  "전략분석",
  "더마블록",
  "위시켓",
]);

export function isSharedDirectoryAccountName(displayName: string) {
  const normalized = displayName.toLocaleLowerCase("ko-KR").replace(/[\s_-]+/g, "");
  return SHARED_ACCOUNT_NAMES.has(normalized)
    || /(?:공용계정|공통계정|대표계정|sharedaccount|serviceaccount)/iu.test(normalized)
    || /^team[a-z0-9가-힣]+$/iu.test(normalized);
}

export function summarizeDirectoryMembers(members: OrgDirectoryMember[]) {
  const counts = new Map<string, number>();
  let excludedAccountCount = 0;
  for (const member of members) {
    if (isSharedDirectoryAccountName(member.displayName)) {
      excludedAccountCount += 1;
      continue;
    }
    const path = normalizePath(member.path);
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  const orgUnits = [...counts.entries()].map(([path, count]) => ({ path, count }));
  return {
    totalActive: orgUnits.reduce((total, item) => total + item.count, 0),
    orgUnits,
    excludedAccountCount,
  };
}

export function mergeOrgUnits(rows: OrgUnitCount[]) {
  const merged = new Map<string, number>();
  for (const row of rows) {
    const path = normalizePath(row.path);
    merged.set(path, (merged.get(path) ?? 0) + row.count);
  }
  return [...merged.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => a.path.localeCompare(b.path, "ko"));
}

export function isOrgHeadcountQuestion(question: string, previousAnswer = "") {
  const asksCount = /(몇\s*명|인원\s*(?:수|현황)?|현원|직원\s*수|구성원\s*수|헤드\s*카운트|head\s*count)/iu.test(question);
  const followsCount = previousAnswer.includes("활성 인원")
    && /(그럼|그러면|은\?|는\?|팀|부서|그룹|group|BU|실|본부|센터)/iu.test(question);
  return asksCount || followsCount;
}

export function formatOrgHeadcountAnswer(question: string, snapshot: OrgDirectorySnapshot) {
  const merged = mergeOrgUnits(snapshot.orgUnits);
  const aggregates = aggregatePaths(merged);
  const target = findTarget(question, aggregates);
  const date = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "long" })
    .format(new Date(snapshot.snapshotAt));

  if (target) {
    return `${date} Google Workspace 동기화 기준 ${target.label} 활성 인원은 ${target.count.toLocaleString("ko-KR")}명입니다. 정지 계정과 비활성 계정은 제외한 수치입니다.`;
  }

  if (/(부서별|팀별|조직별|현황)/u.test(question)) {
    const summary = topLevelSummary(merged)
      .slice(0, 15)
      .map(item => `${item.label} ${item.count.toLocaleString("ko-KR")}명`)
      .join(", ");
    if (summary) {
      return `${date} Google Workspace 동기화 기준 전체 활성 인원은 ${snapshot.totalActive.toLocaleString("ko-KR")}명입니다. 조직별 현황은 ${summary}입니다. 정지 계정과 비활성 계정은 제외했습니다.`;
    }
  }

  return `${date} Google Workspace 동기화 기준 전체 활성 인원은 ${snapshot.totalActive.toLocaleString("ko-KR")}명입니다. 정지 계정과 비활성 계정은 제외한 수치입니다.`;
}

function aggregatePaths(rows: OrgUnitCount[]) {
  const result = new Map<string, number>();
  for (const row of rows) {
    const parts = pathParts(row.path);
    for (let index = 0; index < parts.length; index += 1) {
      const path = `/${parts.slice(0, index + 1).join("/")}`;
      result.set(path, (result.get(path) ?? 0) + row.count);
    }
  }
  return [...result.entries()].map(([path, count]) => ({
    path,
    label: pathParts(path).at(-1) ?? path,
    count,
  }));
}

function findTarget(question: string, candidates: { path: string; label: string; count: number }[]) {
  const normalized = compact(question);
  return candidates
    .filter(item => {
      const fullPath = compact(item.path.replaceAll("/", " "));
      return organizationAliases(item.label).some(alias => alias.length >= 2 && normalized.includes(alias))
        || normalized.includes(fullPath);
    })
    .sort((a, b) => compact(b.label).length - compact(a.label).length || b.path.length - a.path.length)[0];
}

const LETTER_PRONUNCIATION: Record<string, string> = {
  A: "에이", B: "비", C: "씨", D: "디", E: "이", F: "에프", G: "지",
  H: "에이치", I: "아이", J: "제이", K: "케이", L: "엘", M: "엠",
  N: "엔", O: "오", P: "피", Q: "큐", R: "알", S: "에스", T: "티",
  U: "유", V: "브이", W: "더블유", X: "엑스", Y: "와이", Z: "지",
};

export function organizationAliases(label: string) {
  const aliases = new Set<string>();
  const normalized = compact(label);
  const semanticName = normalized.replaceAll("&", "");
  aliases.add(normalized);
  aliases.add(compact(label.replace(/(?:팀|실|그룹|group|bu)$/iu, "")));

  for (const token of label.match(/[A-Z][A-Z&]*\d*/g) ?? []) {
    const letters = token.replace(/[^A-Z]/g, "");
    if (letters.length < 2 || letters.length > 5) continue;
    const digits = token.match(/\d+$/)?.[0] ?? "";
    const spoken = [...letters].map(letter => LETTER_PRONUNCIATION[letter]).join("");
    aliases.add(compact(`${spoken}${digits}`));
    if (token.includes("&")) {
      aliases.add(compact(`${[...letters].map(letter => LETTER_PRONUNCIATION[letter]).join("앤")}${digits}`));
    }
  }

  const englishWords = label.match(/[A-Za-z]+/g) ?? [];
  if (englishWords.length >= 2) {
    const initials = englishWords.map(word => word[0].toUpperCase()).join("");
    if (initials.length <= 5) {
      aliases.add(compact(initials));
      aliases.add(compact([...initials].map(letter => LETTER_PRONUNCIATION[letter]).join("")));
    }
  }

  if (semanticName.includes("peopleculture")) {
    for (const alias of [
      "피플앤컬처", "피플앤컬쳐", "피플컬처", "피플컬쳐", "피컬",
      "피앤씨", "인사", "인사팀", "HR", "에이치알",
    ]) aliases.add(compact(alias));
  }
  if (normalized.includes("연구개발")) {
    for (const alias of ["연구소", "연구팀", "R&D", "RND", "알앤디", "알엔디"]) aliases.add(compact(alias));
  }
  if (normalized.includes("재경")) {
    for (const alias of ["재무", "재무팀", "회계", "회계팀", "파이낸스"]) aliases.add(compact(alias));
  }
  if (normalized.includes("브랜드비주얼")) {
    for (const alias of ["비주얼", "비주얼팀", "브비"]) aliases.add(compact(alias));
  }

  return [...aliases].filter(Boolean);
}

function topLevelSummary(rows: OrgUnitCount[]) {
  const allParts = rows.map(row => pathParts(row.path));
  const commonRoot = allParts.length > 0 && allParts.every(parts => parts[0] === allParts[0][0]) ? 1 : 0;
  const counts = new Map<string, number>();
  for (let index = 0; index < rows.length; index += 1) {
    const label = allParts[index][commonRoot] ?? allParts[index][0] ?? "기타";
    counts.set(label, (counts.get(label) ?? 0) + rows[index].count);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ko"));
}

function normalizePath(value: string) {
  const normalized = `/${value.trim().replace(/^\/+|\/+$/g, "")}`.replace(/\/{2,}/g, "/");
  return normalized === "/" ? "/미분류" : normalized;
}

function pathParts(value: string) {
  return normalizePath(value).split("/").filter(Boolean);
}

function compact(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/[\s/_·()-]+/g, "");
}
