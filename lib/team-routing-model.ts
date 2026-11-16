export type TeamSuggestion = { team: string; contact: string };

const ROUTES: { pattern: RegExp; team: string; contact?: string }[] = [
  { pattern: /(구매|발주|원부자재|재고|물류|공급망|수요\s*예측|납기)/iu, team: "SCM팀" },
  { pattern: /(회계|전표|세금계산서|비용\s*마감|회계\s*마감|법인카드|지출결의|원천징수|연말정산|급여\s*정산)/iu, team: "재경팀" },
  { pattern: /(연차|휴가|근태|채용|입사|퇴사|휴직|복직|인사평가|승진|복리후생|증명서|조직문화)/iu, team: "People&Culture팀" },
  { pattern: /(노트북|컴퓨터|계정|비밀번호|그룹웨어|ERP|네트워크|와이파이|프린터|정보보안|시스템\s*오류)/iu, team: "People&Culture팀", contact: "People&Culture팀 IT 담당" },
  { pattern: /(연구|원료|성분|처방|제형|효능\s*시험|연구개발)/iu, team: "연구개발팀" },
  { pattern: /(메디컬|병원|클리닉|의료진|전문가\s*제품)/iu, team: "메디컬팀" },
  { pattern: /(패키지\s*디자인|용기\s*디자인|제품\s*디자인)/iu, team: "디자인팀" },
  { pattern: /(촬영|비주얼|그래픽|브랜드\s*이미지)/iu, team: "브랜드 비주얼팀" },
  { pattern: /(계약서|법무|경영관리|인감|총무)/iu, team: "경영관리팀" },
  { pattern: /(사업\s*계획|전략|경영\s*기획)/iu, team: "기획실" },
  { pattern: /(중국|중화권)/iu, team: "중국사업팀" },
  { pattern: /(일본|큐텐|qoo10)/iu, team: "일본사업팀" },
];

export function suggestTeam(question: string, availableLabels: string[]): TeamSuggestion | null {
  const labels = [...new Set(availableLabels.map(label => label.trim()).filter(Boolean))];
  const normalizedQuestion = compact(question);

  const explicit = labels
    .filter(label => compact(label).length >= 3 && normalizedQuestion.includes(compact(label)))
    .sort((a, b) => compact(b).length - compact(a).length)[0];
  if (explicit) return { team: explicit, contact: explicit };

  for (const route of ROUTES) {
    if (!route.pattern.test(question)) continue;
    const actual = labels.find(label => compact(label) === compact(route.team));
    if (actual) return { team: actual, contact: route.contact ?? actual };
  }
  return null;
}

function compact(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/[\s/_·&()\-]+/g, "");
}
