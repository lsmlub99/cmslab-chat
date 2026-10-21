const REDACTED = "[보안상 비공개]";

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\b(?:postgres(?:ql)?|mysql):\/\/[^\s]+/gi,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

// 값의 모양만으로 비밀 여부를 판단하면 사번·문서번호까지 가릴 수 있으므로,
// 명시적인 비밀번호 레이블과 구분자(: 또는 =)가 있는 경우만 마스킹합니다.
const LABELLED_SECRET = /((?:비밀번호|패스워드|비번|암호|password|passwd)\s*[:=]\s*)([^\s,;]{4,})/gi;

/** 모델 컨텍스트와 새 지식 저장 전에 고신뢰도 인증정보를 제거합니다. */
export function redactSensitiveText(input: string) {
  let output = input;
  for (const pattern of SECRET_PATTERNS) output = output.replace(pattern, REDACTED);
  return output.replace(LABELLED_SECRET, `$1${REDACTED}`);
}
