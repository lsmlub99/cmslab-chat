type DeterministicAliasInput = {
  title: string;
  category?: string;
  section?: string | null;
  content?: string;
};

const TOPIC_ALIASES: { pattern: RegExp; aliases: string[] }[] = [
  {
    pattern: /(차량\s*대여|업무용\s*(?:차|차량)|법인차|회사차|쏘카|렌터?카|카셰어링|차\s*빌리)/i,
    aliases: [
      "업무용 차는 어떻게 빌려?",
      "회사 차량 대여 방법",
      "법인차 예약",
      "쏘카 사용 방법",
      "렌터카 신청",
      "차량 대여 어디서 해?",
      "카셰어링 이용",
    ],
  },
  {
    pattern: /(주차|주차권|주차장)/i,
    aliases: [
      "직원 주차 신청 어디서 해?",
      "주차 등록 방법",
      "주차 사이트 알려줘",
      "차량 주차 등록",
      "임직원 주차권 신청",
    ],
  },
  {
    pattern: /(회사\s*연혁|회사\s*역사|기업\s*연혁|주요\s*이력)/i,
    aliases: ["회사 역사를 알려줘", "주요 연혁", "회사가 어떻게 성장했어?", "설립 이후 주요 이력"],
  },
  {
    pattern: /(회사\s*소개|회사\s*개요|씨엠에스랩|CMS\s*Lab)/i,
    aliases: ["우리 회사가 어떤 회사야?", "씨엠에스랩 소개", "회사 개요", "원익그룹 편입 시기"],
  },
  {
    pattern: /(브랜드\s*소개|화장품\s*브랜드|셀퓨전씨|수이스킨|더마블록|리페라)/i,
    aliases: ["운영 중인 화장품 브랜드가 뭐야?", "회사 브랜드 목록", "브랜드 종류", "어떤 브랜드가 있어?"],
  },
  {
    pattern: /(노트북|컴퓨터|PC|계정|로그인|전산|IT\s*지원)/i,
    aliases: ["컴퓨터 고장은 누구한테 문의해?", "계정 문제 문의", "IT 지원 요청", "노트북 장애 접수"],
  },
  {
    pattern: /(월별\s*인원|인원\s*현황|조직도|임직원\s*수|직원\s*수)/i,
    aliases: ["월별 직원 수", "현재 인원 현황", "조직도 어디서 봐?", "임직원 수 확인"],
  },
];

function normalized(value: string) {
  return value.replace(/\s+/g, " ").replace(/[;!?。]+$/u, "").trim();
}

function unique(values: string[], limit = 12) {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const alias = normalized(value);
    const key = alias.toLocaleLowerCase("ko-KR");
    if (alias.length < 2 || seen.has(key)) continue;
    seen.add(key);
    output.push(alias);
    if (output.length >= limit) break;
  }
  return output;
}

/**
 * AI 별칭 생성이 실패해도 모든 지식에 최소한의 검색 표현을 보장합니다.
 * 도메인별 구어체는 명시적으로 추가하고, 그 밖의 새 지식에는 제목 기반 표현을 붙입니다.
 */
export function deterministicSearchAliases(input: DeterministicAliasInput) {
  const title = normalized(input.title);
  const haystack = [title, input.category, input.section, input.content].filter(Boolean).join("\n");
  const topicAliases = TOPIC_ALIASES
    .filter(rule => rule.pattern.test(haystack))
    .flatMap(rule => rule.aliases);

  return unique([
    ...topicAliases,
    title,
    `${title} 알려줘`,
    `${title} 관련 내용`,
    `${title} 어디서 확인해?`,
  ]);
}

export function mergeSearchAliases(generated: string[], deterministic: string[]) {
  return unique([...generated, ...deterministic]);
}
