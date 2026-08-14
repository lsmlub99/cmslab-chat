/**
 * AI 호출 실패를 사용 기록에 남길 때 쓰는 짧은 코드.
 *
 * 오류 원문에는 프롬프트 일부나 내부 정보가 섞일 수 있어 그대로 보내면 안 됩니다.
 * 상태 코드나 오류 종류처럼 분류 가능한 짧은 값만 남깁니다.
 */
export function errorCodeOf(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";

  const candidate = error as { status?: number; code?: string; name?: string };
  if (typeof candidate.status === "number") return `http_${candidate.status}`;
  // OpenAI SDK 와 fetch 는 code/name 에 짧은 식별자를 담습니다.
  if (typeof candidate.code === "string" && /^[a-z0-9_]{1,40}$/i.test(candidate.code)) return candidate.code;
  if (typeof candidate.name === "string" && /^[a-z0-9_]{1,40}$/i.test(candidate.name)) return candidate.name;
  return "unknown";
}
