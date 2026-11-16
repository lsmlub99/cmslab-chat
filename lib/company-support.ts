export type CompanySupportAnswer = {
  answer: string;
  category: string;
  links: { url: string; title: string }[];
};

const COMPANY_RULES_URL = "https://drive.google.com/drive/folders/1KrUtrge9wv5RsVWrtEZPsKNn4ohFW64V?usp=drive_link";

export function answerCompanySupportQuestion(question: string): CompanySupportAnswer | null {
  const value = question.trim();

  if (/(주차|방문차량|차량번호|주차권|주차s*정산|차량s*등록)/u.test(value)) {
    return {
      answer: "사무실 이전 예정으로 주차 등록·정산 기준도 변경될 수 있어 현재 확정된 최신 절차를 안내하기 어렵습니다. 새 사무실 주차 기준이 확정되면 지식에 반영하겠습니다.",
      category: "총무·주차",
      links: [],
    };
  }

  if (/(회사|사무실|본사).*(주소|위치|어디|지하철|역|찾아가|택배)|가까운\s*(지하철)?역|택배.*(주소|어디)/u.test(value)) {
    return {
      answer: "사무실 이전 예정으로 정확한 주소·층·택배 수령지는 확정 후 업데이트할 예정입니다. 현재 안내 가능한 가까운 지하철역은 강남역입니다.",
      category: "회사 위치",
      links: [],
    };
  }

  if (/(사내|회사|전체|인사|재무|보안).*(규정|사규)|규정집|취업규칙|사규/u.test(value)) {
    return {
      answer: "사내 전체 규정은 Google Drive의 사내 규정 폴더에서 확인할 수 있습니다. 규정 내용이나 적용 기준에 관한 문의는 피플앤컬처팀에 문의해 주세요.",
      category: "사내 규정",
      links: [{ url: COMPANY_RULES_URL, title: "사내 전체 규정" }],
    };
  }

  if (/(구매|발주|견적서|원부자재|납기|검수).*(절차|프로세스|방법|어떻게|어디|문의|승인|결재|몇\s*개)|^(구매|발주|견적)$/u.test(value)) {
    return {
      answer: "구매·발주의 세부 절차와 금액별 견적 기준은 현재 챗봇 지식에 확정 등록되어 있지 않습니다. 관련 업무는 SCM팀에 문의해 주세요.",
      category: "구매·발주",
      links: [],
    };
  }

  if (/(대체\s*휴무|대휴|보상\s*휴가|주말\s*근무.*휴무|휴일\s*근무.*휴무)/u.test(value)) {
    return {
      answer: "주말 근무에 따른 대체휴무는 1.5배를 기준으로 합니다. 개인별 계산과 실제 적용 기준은 피플앤컬처팀에 문의해 주세요.",
      category: "대체휴무",
      links: [],
    };
  }

  if (/(동호회|사내\s*모임|취미\s*모임|사내\s*클럽).*(가입|신설|개설|만들|신청|들어가|절차|방법)/u.test(value)) {
    return {
      answer: "동호회 가입이나 신설 절차는 피플앤컬처팀에 문의해 주세요.",
      category: "동호회",
      links: [],
    };
  }

  if (/육아\s*휴직.*(신청|절차|서류|첨부|담당|문의|방법)/u.test(value)) {
    return {
      answer: "육아휴직 신청 절차와 필요한 서류는 개인별 상황에 따라 확인이 필요하므로 피플앤컬처팀에 문의해 주세요.",
      category: "육아휴직",
      links: [],
    };
  }

  return null;
}
