/**
 * 욕설·비방·성적 표현 차단.
 *
 * 왜 사전이 주 방어선인가: OpenAI 모더레이션 API 를 한국어로 시험해 보니
 * "씨발", "개새끼", "섹스에 대해 알려줘" 같은 입력을 그냥 통과시켰습니다
 * (10건 중 6건 미탐). 정상 질문을 잘못 막는 일은 없었지만 잡아야 할 것을
 * 못 잡으면 소용이 없고, 호출마다 1초가 더 붙습니다.
 * 그래서 한국어 사전으로 먼저 막고, 모더레이션 API 는 선택 기능으로 둡니다.
 *
 * 오탐이 미탐보다 위험합니다. 정상 업무 질문을 막으면 챗봇을 못 쓰게 됩니다.
 * 특히 아래 표현들은 반드시 통과해야 합니다.
 *   · "보지 못했습니다", "자지 않았어요"  — 흔한 동사 활용
 *   · "시발점", "성과 지표", "개선 방안"  — 욕설과 글자가 겹치는 정상 단어
 *   · "출산휴가", "임신", "생리휴가"      — 인사 규정 질문
 *   · 리페라 설명서의 "점막", "여드름"     — 제품 안내
 */

export type ModerationResult = {
  blocked: boolean;
  /** 무엇 때문에 막혔는지 — 사용자에게는 알리지 않고 기록에만 남깁니다. */
  reason?: "profanity" | "sexual" | "threat" | "api";
};

/**
 * 우회를 막기 위한 정규화.
 * "ㅅ.ㅂ", "씨 발", "시1발" 처럼 사이에 기호나 숫자를 끼워 넣는 방식에 대응합니다.
 * 한글·영문·숫자만 남기고 반복 문자는 두 개까지 줄입니다.
 */
export function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[\s.,!?~\-_*^'"`/\\|()[\]{}<>@#$%&+=:;]/g, "")
    // 자모 사이에 낀 숫자 제거: 시1발 → 시발
    .replace(/(?<=[가-힣ㄱ-ㅎ])[0-9](?=[가-힣ㄱ-ㅎ])/g, "")
    .replace(/(.)\1{2,}/g, "$1$1");
}

/*
 * 검사는 두 단계로 나눕니다.
 *
 * 띄어쓰기를 지우고 검사하면 우회("씨 발", "ㅅ.ㅂ")에는 강하지만,
 * 멀쩡한 단어들이 붙어서 욕설처럼 보이는 사고가 납니다.
 * 실제 지식 문서를 전부 돌려 보고 아래 세 가지를 발견했습니다.
 *   "다음 부위로 이동"   -> 다음부위   -> 음부
 *   "테두리에 미세 흠집" -> 리에미세   -> 에미
 *   "윈도우 탐색기"      -> 탐색기     -> 색기
 * 그래서 짧고 다른 낱말에 섞이기 쉬운 표현은 띄어쓰기를 살린 채,
 * 앞뒤가 한글이 아닌 경우에만 걸리도록 따로 검사합니다.
 */

/**
 * 띄어쓰기를 지운 형태로 검사합니다.
 * 다른 낱말 속에 우연히 들어갈 일이 없는 표현만 넣습니다.
 */
const PROFANITY: RegExp[] = [
  // 시발 계열 — "시발점", "시발역" 은 정상 단어라 제외합니다.
  /[씨시쒸쉬]([1-9]?)[발벌팔빨바]/u,
  /ㅅㅂ|ㅆㅂ|ㅅ1ㅂ/u,
  // 병신 계열
  /병[신씬]|븅신|ㅂㅅ/u,
  // 좆 계열 — "존재", "존중", "졸업" 은 걸리지 않습니다.
  /좆|좃|존나|졷|ㅈㄴ(?![가-힣])/u,
  /*
   * 새끼 계열.
   * "세끼"(하루 세 끼)와 "색기"(탐색기·검색기)는 정상 단어라 넣지 않습니다.
   */
  /새[끼키꺄]|쌔끼|ㅅㄲ/u,
  // 지랄 계열
  /지랄|ㅈㄹ(?![가-힣])/u,
  // 씹 계열 — "씹다"(먹다) 활용형은 제외합니다.
  /씹(?!어|고|는|었|으)/u,
  /*
   * 애미 계열.
   * "에미"는 "테두리에 미세", "임금에 미달"처럼 조사와 붙어 자주 생깁니다.
   * "니미"도 "니 미팅"이 걸립니다. 앞말이 붙은 형태만 잡습니다.
   */
  /니미[럴씨랄]|[니네]애미|엠창/u,
  // 기타 모욕
  /등신|머저리|얼간이|또라이|돌아이|미친[놈년것]|개소리|개같|좆같|꺼져|닥쳐|엿먹/u,
];

/** 시발 계열에서 걸러 낼 정상 단어. */
const PROFANITY_EXCEPTIONS = [/시발점/u, /시발역/u, /시발자/u];

/** 성적 표현. 의료·인사 맥락의 정상 단어와 겹치지 않도록 좁게 잡습니다. */
const SEXUAL: RegExp[] = [
  /섹스|쎅스|섹까|성관계|성행위/u,
  /야동|야설|음란|포르노|야한거|야한얘기|야한이야기/u,
  /자위행위|딸딸이|딸치/u,
  /변태|발정|꼴리|떡치/u,
];

/** 위협·자해. */
const THREAT: RegExp[] = [
  /죽여버|죽여줄|죽일놈|뒤져버|패버[리릴려]|때려죽/u,
  /자살하|목매달|뛰어내려/u,
];

/**
 * 낱말 단위로만 검사하는 표현들.
 *
 * "음부"는 "다음 부위"에, "성기"는 "작성 기준"에 섞여 들어갑니다.
 * 띄어쓰기를 지우면 이런 것들이 전부 걸리므로, 원문 그대로 두고
 * 앞뒤에 한글이 붙어 있지 않을 때만 인정합니다.
 *
 * "보지"와 "자지"는 일부러 넣지 않았습니다.
 * 낱말 단위로 잡아도 "문서를 보지 못했습니다", "잠을 자지 않았어요" 처럼
 * 아주 흔한 동사 활용이 그대로 걸립니다. 뒤에 오는 말(못·않·말)로 예외를
 * 두어도 활용형이 워낙 많아 새는 곳이 계속 생깁니다.
 * 정상 문장을 막는 손해가, 이 낱말 하나를 놓치는 손해보다 큽니다.
 * 이런 표현까지 잡으려면 MODERATION_API=on 으로 API 검사를 함께 켜세요.
 */
const WORD_LEVEL_SEXUAL = ["음부", "성기", "음경", "고환"];

function matchesWordLevel(text: string) {
  return WORD_LEVEL_SEXUAL.some(word => {
    const pattern = new RegExp(`(^|[^가-힣])${word}([^가-힣]|$)`, "u");
    return pattern.test(text);
  });
}

function matches(patterns: RegExp[], text: string) {
  return patterns.some(pattern => pattern.test(text));
}

/**
 * 사전 기반 검사. 지연이 없어 모든 질문에 적용합니다.
 */
export function checkWithDictionary(text: string): ModerationResult {
  const normalized = normalize(text);

  // 낱말 단위 검사는 원문(띄어쓰기 유지)에 대고 합니다.
  if (matchesWordLevel(text)) return { blocked: true, reason: "sexual" };
  if (matches(SEXUAL, normalized)) return { blocked: true, reason: "sexual" };
  if (matches(THREAT, normalized)) return { blocked: true, reason: "threat" };

  if (matches(PROFANITY, normalized)) {
    // 정상 단어가 우연히 걸린 경우를 되돌립니다.
    const isException = PROFANITY_EXCEPTIONS.some(pattern => pattern.test(normalized));
    if (!isException) return { blocked: true, reason: "profanity" };
  }

  return { blocked: false };
}

/**
 * OpenAI 모더레이션 API. 사전이 놓치는 맥락형 비방(예: "김부장 그 사람 언제 잘려?")을
 * 잡지만 호출마다 약 1초가 붙습니다. MODERATION_API=on 일 때만 씁니다.
 */
async function checkWithApi(text: string): Promise<ModerationResult> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { blocked: false };

  try {
    const response = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { blocked: false };

    const data = await response.json();
    return data.results?.[0]?.flagged ? { blocked: true, reason: "api" } : { blocked: false };
  } catch {
    // 검사에 실패했다고 정상 질문까지 막을 이유는 없습니다.
    return { blocked: false };
  }
}

export function usesModerationApi() {
  return process.env.MODERATION_API?.trim().toLowerCase() === "on";
}

/** 질문을 검사합니다. 사전이 먼저 걸러 내고, 설정된 경우에만 API 까지 확인합니다. */
export async function checkQuestion(text: string): Promise<ModerationResult> {
  const dictionary = checkWithDictionary(text);
  if (dictionary.blocked) return dictionary;
  if (!usesModerationApi()) return { blocked: false };
  return checkWithApi(text);
}

/** 사용자에게 보여 줄 안내. 어떤 표현이 걸렸는지는 알리지 않습니다. */
export const BLOCKED_MESSAGE =
  "업무와 관련된 질문만 답변할 수 있습니다. 표현을 다듬어 다시 질문해 주세요.";
