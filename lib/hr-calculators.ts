export type CalculatorHistoryTurn = {
  question: string;
  answer: string;
};

export type HrCalculatorOutcome = {
  kind: "annual_leave" | "severance";
  phase: "prompt" | "result";
  answer: string;
  category: string;
  links: { url: string; title: string }[];
};

const ANNUAL_LEAVE_LAW_URL =
  "https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1012792285";
const RETIREMENT_CALCULATOR_URL = "https://www.moel.go.kr/retirementpayCal.do";
const RETIREMENT_LAW_URL =
  "https://law.go.kr/LSW/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1033846297";

const ANNUAL_YEARS_PROMPT = "입사일부터 오늘까지 꽉 채운 만 근속연수";
const ANNUAL_MONTHS_PROMPT = "만 1년 미만이면 개근한 개월 수";
const SEVERANCE_PROMPT = "퇴직금 예상액을 계산하려면";

export function answerHrCalculator(
  question: string,
  history: CalculatorHistoryTurn[] = [],
): HrCalculatorOutcome | null {
  const current = question.trim();
  const lastAnswer = history.at(-1)?.answer ?? "";
  const annualPending = lastAnswer.includes(ANNUAL_YEARS_PROMPT)
    || lastAnswer.includes(ANNUAL_MONTHS_PROMPT);
  const severancePending = lastAnswer.includes(SEVERANCE_PROMPT);

  if (severancePending || isSeveranceQuestion(current)) {
    return answerSeverance(current, history);
  }
  if (annualPending || isAnnualLeaveQuestion(current)) {
    return answerAnnualLeave(current, history);
  }
  return null;
}

function isAnnualLeaveQuestion(value: string) {
  return /(연차|월차|유급휴가)/u.test(value)
    && /(계산|몇\s*(?:개|일)|며칠|일수|발생|부여)/u.test(value);
}

function isSeveranceQuestion(value: string) {
  return /(퇴직금|퇴직급여)/u.test(value)
    && /(계산|산정|얼마|예상|모의)/u.test(value);
}

function answerAnnualLeave(
  question: string,
  history: CalculatorHistoryTurn[],
): HrCalculatorOutcome {
  const relevant = relevantQuestions(history, answer =>
    answer.includes(ANNUAL_YEARS_PROMPT) || answer.includes(ANNUAL_MONTHS_PROMPT), question);
  const completedYears = parseCompletedYears(relevant);
  const completedMonths = parseCompletedMonths(relevant);
  const links = [{ url: ANNUAL_LEAVE_LAW_URL, title: "근로기준법 제60조 연차 유급휴가" }];

  if (completedYears === null) {
    return {
      kind: "annual_leave",
      phase: "prompt",
      category: "연차 계산",
      links,
      answer: [
        "연차를 계산하려면 입사일부터 오늘까지 꽉 채운 만 근속연수를 알려주세요.",
        "예: `만 3년`",
        "만 1년 미만이면 `만 0년, 개근 8개월`처럼 개근한 개월 수도 함께 적어주세요.",
      ].join("\n"),
    };
  }

  if (completedYears === 0 && completedMonths === null) {
    return {
      kind: "annual_leave",
      phase: "prompt",
      category: "연차 계산",
      links,
      answer: [
        "만 1년 미만이면 개근한 개월 수를 알려주세요.",
        "예: `개근 8개월`",
        "법정 기준은 1개월 개근 시 1일이며 최대 11일입니다.",
      ].join("\n"),
    };
  }

  if (completedYears === 0) {
    const months = Math.max(0, Math.min(11, completedMonths ?? 0));
    return {
      kind: "annual_leave",
      phase: "result",
      category: "연차 계산",
      links,
      answer: [
        `만 1년 미만이고 ${months}개월 개근했다면 법정 발생 연차는 ${months}일입니다.`,
        "계산: 1개월 개근 × 1일, 최대 11일",
        "회사는 입사 1년 미만 구성원에게 11일을 선지급해 운영할 수 있으므로 실제 사용 가능 일수는 넥스프라임에서 확인해 주세요.",
        "휴직·결근·입사일 산정 등으로 값이 다르면 피플앤컬처팀에 문의해 주세요.",
      ].join("\n"),
    };
  }

  const days = Math.min(25, 15 + Math.floor((completedYears - 1) / 2));
  return {
    kind: "annual_leave",
    phase: "result",
    category: "연차 계산",
    links,
    answer: [
      `만 ${completedYears}년 근속하고 직전 1년 출근율이 80% 이상이라면 법정 연차는 ${days}일입니다.`,
      `계산: 15일 + ⌊(만 ${completedYears}년 - 1) ÷ 2⌋ = ${days}일, 최대 25일`,
      "휴직·결근·회사 부여일 기준 등에 따라 실제 사용 가능 일수는 달라질 수 있으니 넥스프라임에서 확인해 주세요.",
      "계산 결과가 다르면 피플앤컬처팀에 문의해 주세요.",
    ].join("\n"),
  };
}

function answerSeverance(
  question: string,
  history: CalculatorHistoryTurn[],
): HrCalculatorOutcome {
  const relevant = relevantQuestions(history, answer => answer.includes(SEVERANCE_PROMPT), question);
  const startDate = parseLabeledDate(relevant, ["입사일자", "입사일"]);
  const lastWorkDate = parseLabeledDate(relevant, ["마지막 근무일", "최종 근무일"]);
  const suppliedRetirementDate = parseLabeledDate(relevant, ["퇴직일자", "퇴직일", "퇴사일자", "퇴사일"]);
  const retirementDate = lastWorkDate ? addUtcDays(lastWorkDate, 1) : suppliedRetirementDate;
  const wageTotal = parseLabeledMoney(relevant, [
    "퇴직 전 3개월 세전 임금총액",
    "퇴직전 3개월 세전 임금총액",
    "3개월 임금총액",
    "3개월 급여총액",
    "임금총액",
  ]);
  const bothExtrasNone = /상여금[^\n,]*연차수당[^\n,]*(?:없|0)/u.test(relevant);
  const annualBonus = bothExtrasNone ? 0 : parseOptionalMoney(relevant, ["최근 1년 상여금", "연간 상여금", "상여금"]);
  const annualLeavePay = bothExtrasNone ? 0 : parseOptionalMoney(relevant, ["퇴직 전년도 연차수당", "연차수당"]);
  const ordinaryDailyWage = parseOptionalMoney(relevant, ["1일 통상임금", "통상일급", "통상임금"], true);
  const suppliedPeriodDays = parseLabeledInteger(relevant, ["3개월 총일수", "평균임금 기간 총일수", "산정기간 총일수"]);
  const links = [
    { url: RETIREMENT_CALCULATOR_URL, title: "고용노동부 퇴직금 계산기" },
    { url: RETIREMENT_LAW_URL, title: "근로자퇴직급여 보장법 제8조" },
  ];

  const missing: string[] = [];
  if (!startDate) missing.push("입사일");
  if (!retirementDate) missing.push("퇴직일(마지막 근무일의 다음 날)");
  if (wageTotal === null) missing.push("퇴직 전 3개월 세전 임금총액");
  if (annualBonus === null) missing.push("최근 1년 상여금(없으면 0원)");
  if (annualLeavePay === null) missing.push("반영할 연차수당(없으면 0원)");

  if (missing.length) {
    return {
      kind: "severance",
      phase: "prompt",
      category: "퇴직금 계산",
      links,
      answer: [
        "퇴직금 예상액을 계산하려면 아래 값을 알려주세요.",
        ...missing.map(item => `- ${item}`),
        "- 1일 통상임금(알면 입력, 모르면 `모름`)",
        "예: `입사일 2022-01-03, 퇴직일 2026-12-01, 3개월 임금총액 1,200만원, 상여금 400만원, 연차수당 30만원, 통상일급 모름`",
        "퇴직일은 마지막으로 근무한 날의 다음 날을 적어주세요.",
        "값을 정확히 알기 어렵다면 고용노동부 퇴직금 계산기를 이용하거나 피플앤컬처팀에 문의해 주세요.",
      ].join("\n"),
    };
  }

  if (!isValidDateOrder(startDate!, retirementDate!)) {
    return {
      kind: "severance",
      phase: "prompt",
      category: "퇴직금 계산",
      links,
      answer: "퇴직일은 입사일보다 뒤여야 합니다. 날짜를 다시 확인해 주세요. 정확한 산정이 필요하면 고용노동부 퇴직금 계산기를 이용하거나 피플앤컬처팀에 문의해 주세요.",
    };
  }

  const serviceDays = utcDayDifference(startDate!, retirementDate!);
  if (serviceDays < 365) {
    return {
      kind: "severance",
      phase: "result",
      category: "퇴직금 계산",
      links,
      answer: [
        `계속근로기간은 ${serviceDays.toLocaleString("ko-KR")}일로 계산됩니다.`,
        "법정 퇴직금은 원칙적으로 계속근로기간이 1년 이상인 근로자에게 적용됩니다.",
        "근무시간·제외기간·회사 제도에 따라 판단이 달라질 수 있으니 피플앤컬처팀에 확인해 주세요.",
      ].join("\n"),
    };
  }

  const periodDays = suppliedPeriodDays && suppliedPeriodDays > 0
    ? suppliedPeriodDays
    : averageWagePeriodDays(retirementDate!);
  const adjustedWageTotal = wageTotal! + annualBonus! / 4 + annualLeavePay! / 4;
  const averageDailyWage = adjustedWageTotal / periodDays;
  const calculationDailyWage = ordinaryDailyWage !== null
    ? Math.max(averageDailyWage, ordinaryDailyWage)
    : averageDailyWage;
  const estimatedSeverance = calculationDailyWage * 30 * serviceDays / 365;
  const usedOrdinary = ordinaryDailyWage !== null && ordinaryDailyWage > averageDailyWage;

  return {
    kind: "severance",
    phase: "result",
    category: "퇴직금 계산",
    links,
    answer: [
      `예상 퇴직금은 약 ${formatWon(estimatedSeverance)}원입니다.`,
      `계속근로기간: ${serviceDays.toLocaleString("ko-KR")}일`,
      `평균임금 산정기간: ${periodDays.toLocaleString("ko-KR")}일`,
      `평균임금 반영 총액: ${formatWon(adjustedWageTotal)}원`,
      `1일 평균임금: ${formatWon(averageDailyWage)}원`,
      ordinaryDailyWage !== null
        ? `계산에 사용한 1일 임금: ${formatWon(calculationDailyWage)}원${usedOrdinary ? "(통상임금이 더 커서 통상임금 적용)" : ""}`
        : "1일 통상임금은 입력되지 않아 평균임금과의 비교는 반영하지 않았습니다.",
      `계산식: ${formatWon(calculationDailyWage)}원 × 30일 × ${serviceDays.toLocaleString("ko-KR")}일 ÷ 365`,
      "세전 모의계산이며 미산입기간, 근무제외기간, 임금 포함 범위, DB형 퇴직연금 운용 결과에 따라 실제 금액은 달라질 수 있습니다.",
      "최종 금액은 고용노동부 계산기와 피플앤컬처팀에서 확인해 주세요.",
    ].join("\n"),
  };
}

function relevantQuestions(
  history: CalculatorHistoryTurn[],
  isPrompt: (answer: string) => boolean,
  current: string,
) {
  const promptIndex = history.findLastIndex(turn => isPrompt(turn.answer));
  const previous = promptIndex >= 0 ? history.slice(promptIndex).map(turn => turn.question) : [];
  return [...previous, current].join("\n");
}

function parseCompletedYears(value: string) {
  const explicit = value.match(/만\s*(\d{1,2})\s*년/u);
  if (explicit) return Number(explicit[1]);
  const completed = value.match(/(\d{1,2})\s*년\s*(?:근속|근무|됐|되었|채움|완료)/u);
  if (completed) return Number(completed[1]);
  const standalone = value.trim().match(/^(\d{1,2})(?:\s*년)?$/u);
  return standalone ? Number(standalone[1]) : null;
}

function parseCompletedMonths(value: string) {
  const match = value.match(/(?:개근\s*)?(\d{1,2})\s*개월/u);
  return match ? Number(match[1]) : null;
}

function parseLabeledDate(value: string, labels: string[]) {
  for (const label of labels.sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s*(?:은|는|:|=)?\\s*(\\d{4})\\s*(?:년|[.\\/-])\\s*(\\d{1,2})\\s*(?:월|[.\\/-])\\s*(\\d{1,2})\\s*일?`, "u");
    const match = value.match(pattern);
    if (!match) continue;
    const date = utcDate(Number(match[1]), Number(match[2]), Number(match[3]));
    if (date) return date;
  }
  return null;
}

function parseLabeledMoney(value: string, labels: string[]) {
  for (const label of labels.sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s*(?:은|는|:|=)?\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(억원?|천만원|백만원|만원|만|천원|원)?`, "u");
    const match = value.match(pattern);
    if (match) return moneyValue(match[1], match[2]);
  }
  return null;
}

function parseOptionalMoney(value: string, labels: string[], allowUnknown = false) {
  const parsed = parseLabeledMoney(value, labels);
  if (parsed !== null) return parsed;
  for (const label of labels) {
    const nearby = `${escapeRegExp(label)}[^\\n,]{0,12}`;
    if (allowUnknown && new RegExp(`${nearby}(?:없|모름|몰라)`, "u").test(value)) return null;
    if (new RegExp(`${nearby}0(?:원)?`, "u").test(value)) return 0;
    if (!allowUnknown && new RegExp(`${nearby}없`, "u").test(value)) return 0;
  }
  return null;
}

function parseLabeledInteger(value: string, labels: string[]) {
  for (const label of labels) {
    const match = value.match(new RegExp(`${escapeRegExp(label)}\\s*(?:은|는|:|=)?\\s*(\\d{1,3})\\s*일?`, "u"));
    if (match) return Number(match[1]);
  }
  return null;
}

function moneyValue(raw: string, unit = "원") {
  const amount = Number(raw.replace(/,/g, ""));
  const multiplier = unit === "억" || unit === "억원" ? 100_000_000
    : unit === "천만원" ? 10_000_000
      : unit === "백만원" ? 1_000_000
        : unit === "만원" || unit === "만" ? 10_000
          : unit === "천원" ? 1_000
            : 1;
  return amount * multiplier;
}

function utcDate(year: number, month: number, day: number) {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day
    ? value
    : null;
}

function addUtcDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 86_400_000);
}

function utcDayDifference(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function isValidDateOrder(start: Date, end: Date) {
  return end.getTime() > start.getTime();
}

function averageWagePeriodDays(retirementDate: Date) {
  const start = subtractUtcMonthsClamped(retirementDate, 3);
  return utcDayDifference(start, retirementDate);
}

function subtractUtcMonthsClamped(value: Date, months: number) {
  const totalMonths = value.getUTCFullYear() * 12 + value.getUTCMonth() - months;
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(value.getUTCDate(), lastDay)));
}

function formatWon(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

