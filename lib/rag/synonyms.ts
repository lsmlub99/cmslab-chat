/**
 * 한국어 동의어 사전.
 *
 * 왜 필요한가: 유사어 처리는 임베딩에만 의존하고 있었습니다. 키워드 검색은 글자가
 * 같아야 걸리므로 "휴가"로는 "연차"를 못 찾습니다. 실제로 표현을 바꿔 물었을 때
 * 정답 문서가 1위로 나온 비율이 77%(20/26)였고, 실패는 두 종류였습니다.
 *   · 진짜 동의어 실패 — "부의금"으로 경조사 문서를, "랩탑"으로 노트북 문서를 못 찾음
 *   · 문서 간 경쟁 — "휴가 며칠?"이 연차(인사행정) 대신 복리후생을 물어옴
 *
 * 모델로 질의를 확장하면 잘 해결되지만 질문마다 호출이 하나 더 붙습니다.
 * 자주 쓰는 낱말은 사전으로 처리하면 지연 없이 같은 효과를 냅니다.
 * 모르는 낱말은 사전이 손대지 않으므로, 모델 확장과 함께 쓰면 서로를 보완합니다.
 *
 * 한 줄이 하나의 뜻 묶음입니다. 어느 낱말로 물어도 나머지가 함께 검색됩니다.
 * 사내에서 쓰는 말이 바뀌면 여기만 고치면 됩니다.
 */
const GROUPS: string[][] = [
  // 휴가·근태
  ["휴가", "연차", "연차휴가", "월차", "유급휴가", "휴가일수", "연차일수"],
  ["반차", "반일휴가"],
  ["출산휴가", "출산전후휴가", "산전후휴가", "출산휴직"],
  ["육아휴직", "육아기", "육아기근로시간단축"],
  ["병가", "질병휴가"],
  ["근태", "출퇴근", "출근", "퇴근", "근무시간"],
  ["재택근무", "재택", "원격근무", "리모트"],
  ["유연근무", "시차출퇴근", "선택근무"],

  // 경조사
  ["경조사", "경조금", "경조비", "축의금", "부의금", "조의금", "경조휴가", "경조 지원"],
  ["장례", "상조", "조사", "부고", "사망", "별세"],
  ["결혼", "혼례", "혼인", "예식"],

  // 인사·증명
  ["재직증명서", "재직확인서", "재직증명", "재직 증명"],
  ["경력증명서", "경력확인서", "경력증명"],
  ["소득증명서", "원천징수영수증", "소득금액증명"],
  ["급여", "월급", "임금", "연봉", "보수"],
  ["퇴사", "퇴직", "사직", "이직"],
  ["입사", "온보딩", "신규입사", "입사자"],
  ["수습", "인턴", "시용"],
  ["인사팀", "피컬팀", "HR", "인사부서"],
  ["워크데이", "Workday", "E-HR", "EHR", "HR Portal"],

  // 복리후생
  ["복리후생", "복지", "후생", "복지제도"],
  ["건강검진", "종합검진", "신체검사", "건강진단"],
  ["교육비", "학원비", "수강료", "자기계발비", "교육 지원", "도서구입비"],
  ["동호회", "사내모임", "클럽"],
  ["제휴", "할인", "임직원할인", "제휴할인"],

  // IT·전산
  ["노트북", "랩탑", "랩톱", "PC", "컴퓨터", "데스크탑", "전산자원", "전산장비"],
  ["와이파이", "WiFi", "wifi", "무선인터넷", "무선랜", "인터넷"],
  ["비밀번호", "패스워드", "비번", "암호"],
  ["계정", "아이디", "ID", "로그인"],
  ["그룹웨어", "인트라넷", "사내시스템"],
  ["메일", "이메일", "메일함", "Gmail"],
  ["복합기", "프린터", "인쇄", "출력"],
  ["회의실", "미팅룸", "회의공간"],
  ["수리", "AS", "고장", "장애", "교체"],

  // 총무
  ["법인카드", "법카", "회사카드"],
  ["출장비", "출장경비", "여비", "출장 정산"],
  ["주차", "주차권", "주차장", "주차지원"],
  ["사무용품", "비품", "소모품"],
  ["명함", "사원증"],
];

type ConceptRule = { when: (question: string) => boolean; terms: string[] };

const DEATH = /(돌아가|사망|별세|상을\s*당|장례|부고|임종|조부상|조모상|부친상|모친상|빙부상|빙모상)/;
const MARRIAGE = /(결혼|혼인|혼례|예식|시집|장가)/;
const GRANDPARENT = /(할아버지|할아버님|할머니|할머님|외할아버지|외할머니|조부|조모|조부모|외조부|외조모)/;
const PARENT = /(아버지|아빠|어머니|엄마|부모|장인|장모|시아버지|시어머니)/;
const SPOUSE = /(남편|아내|배우자|와이프)/;
const SIBLING = /(형|누나|오빠|언니|동생|형제|자매)/;

/**
 * 낱말 하나가 아니라 문장 속 상황을 사내 문서의 표준 표현으로 바꿉니다.
 * 관계와 사건을 함께 확인하므로 "할아버지 건강검진"을 조부모상으로 오해하지 않습니다.
 */
const CONCEPT_RULES: ConceptRule[] = [
  {
    when: question => /(연차|월차|연차휴가)/.test(question),
    terms: ["연차", "연차휴가", "월차", "휴가", "연차일수", "연차사용"],
  },
  {
    when: question => /휴가/.test(question) && !/(출산|배우자출산|난임|가족돌봄|경조|육아)/.test(question),
    terms: ["휴가", "연차", "연차휴가", "월차", "휴가일수"],
  },
  {
    when: question => /(쉬고\s*싶|쉴\s*수|하루\s*쉬|며칠\s*쉬|쉬는\s*날)/.test(question),
    terms: ["휴가", "연차", "연차휴가", "휴가일수"],
  },
  {
    when: question => DEATH.test(question) && GRANDPARENT.test(question) && SPOUSE.test(question),
    terms: ["경조사", "사망", "배우자 외조부모", "배우자 조부모 사망", "경조금", "경조휴가"],
  },
  {
    when: question => DEATH.test(question) && GRANDPARENT.test(question) && !SPOUSE.test(question),
    terms: ["경조사", "사망", "본인 외조부모", "조부모 사망", "경조금", "경조휴가"],
  },
  {
    when: question => DEATH.test(question) && PARENT.test(question),
    terms: ["경조사", "사망", "부모 사망", "본인 배우자 부모", "경조금", "경조휴가"],
  },
  {
    when: question => DEATH.test(question) && SPOUSE.test(question)
      && !GRANDPARENT.test(question) && !PARENT.test(question) && !SIBLING.test(question),
    terms: ["경조사", "배우자 사망", "경조금", "경조휴가"],
  },
  {
    when: question => DEATH.test(question) && /(아들|딸|자녀|아이|우리\s*애)/.test(question),
    terms: ["경조사", "자녀 사망", "경조금", "경조휴가"],
  },
  {
    when: question => DEATH.test(question) && SIBLING.test(question),
    terms: ["경조사", "형제자매 사망", "경조금", "경조휴가"],
  },
  {
    when: question => MARRIAGE.test(question) && /(아들|딸|자녀|아이|우리\s*애)/.test(question),
    terms: ["경조사", "자녀 결혼", "경조금", "경조휴가", "혼인"],
  },
  {
    when: question => MARRIAGE.test(question) && SIBLING.test(question),
    terms: ["경조사", "형제자매 결혼", "경조금", "경조휴가", "혼인"],
  },
  {
    when: question => MARRIAGE.test(question) && /(내가|제가|저는|본인|제\s*결혼)/.test(question),
    terms: ["경조사", "본인 결혼", "경조금", "경조휴가", "혼인"],
  },
  {
    when: question => /(회갑|환갑|칠순)/.test(question),
    terms: ["경조사", "회갑", "칠순", "부모", "경조금", "경조휴가"],
  },
  {
    when: question => /(아이|아기|자녀).*(돌잔치|첫돌)|(?:돌잔치|첫돌).*(아이|아기|자녀)/.test(question),
    terms: ["경조사", "자녀 돌", "경조금"],
  },
  {
    when: question => DEATH.test(question),
    terms: ["경조사", "사망", "장례", "경조금", "경조휴가"],
  },
  {
    when: question => MARRIAGE.test(question),
    terms: ["경조사", "결혼", "혼인", "경조금", "경조휴가"],
  },
];

/** 낱말 → 같은 뜻 묶음. 소문자로 맞춰 찾습니다. */
const INDEX = new Map<string, string[]>();
for (const group of GROUPS) {
  for (const word of group) {
    const key = word.toLowerCase();
    // 한 낱말이 여러 묶음에 속할 수 있으므로 합칩니다.
    INDEX.set(key, [...new Set([...(INDEX.get(key) ?? []), ...group])]);
  }
}

/**
 * 검색어에 같은 뜻의 낱말을 더합니다.
 *
 * 원래 낱말이 먼저 오도록 두고, 확장어는 뒤에 붙입니다.
 * 확장이 너무 많으면 질문의 초점이 흐려지므로 상한을 둡니다.
 */
export function expandTerms(terms: string[], limit = 24) {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(term);
    if (output.length >= limit) return output;
  }

  for (const term of terms) {
    for (const synonym of INDEX.get(term.toLowerCase()) ?? []) {
      const key = synonym.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(synonym);
      if (output.length >= limit) return output;
    }
  }
  return output;
}

/** 질문 전체 문맥에서 추론한 표준 업무 용어까지 합칩니다. */
export function expandQueryTerms(question: string, terms: string[], limit = 32) {
  const inferred = CONCEPT_RULES
    .filter(rule => rule.when(question))
    .flatMap(rule => rule.terms);
  return expandTerms([...terms, ...inferred], limit);
}

/**
 * 임베딩 검색에 쓸 문장.
 * 원문 뒤에 동의어를 덧붙이면 "휴가"로 물어도 "연차" 문서에 가까워집니다.
 * 원문을 앞에 그대로 두어 질문의 의도가 희석되지 않게 합니다.
 */
export function expandForEmbedding(question: string, terms: string[]) {
  const expanded = expandQueryTerms(question, terms);
  const original = new Set(terms.map(term => term.toLowerCase()));
  const added = expanded.filter(term => !original.has(term.toLowerCase()));
  return added.length ? `${question} ${added.join(" ")}` : question;
}

/** 사전에 등록된 낱말 수 — 점검용. */
export function synonymCount() {
  return INDEX.size;
}
