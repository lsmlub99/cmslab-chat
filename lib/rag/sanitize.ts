/**
 * 모델 출력 정리.
 *
 * 챗봇 화면은 마크다운을 렌더링하지 않고 문자열을 그대로 보여 줍니다.
 * 그래서 모델이 **굵게** 나 `코드` 를 쓰면 별표와 백틱이 그대로 화면에 남습니다.
 * 원본 문서(리페라 설명서 등)에 들어 있는 둥근 따옴표도 그대로 흘러나옵니다.
 * 프롬프트로 1차 억제하고, 여기서 2차로 걷어냅니다.
 *
 * 코드에 보이지 않는 문자를 직접 적으면 편집·검색이 어려우므로 모두 \u 이스케이프로 씁니다.
 */

/** 화면에서 이상하게 보이는 문자 → 안전한 대체 문자. */
const REPLACEMENTS: Record<string, string> = {
  "“": '"', // “
  "”": '"', // ”
  "„": '"', // „
  "‟": '"', // ‟
  "«": '"', // «
  "»": '"', // »
  "″": '"', // ″
  "‘": "'", // ‘
  "’": "'", // ’
  "‚": "'", // ‚
  "‛": "'", // ‛
  "′": "'", // ′
  "–": "-", // – en dash
  "—": "-", // — em dash
  "―": "-", // ―
  "−": "-", // − minus
  " ": " ", // no-break space
  " ": " ", // figure space
  " ": " ", // narrow no-break space
  "　": " ", // ideographic space
  "​": "", // zero width space
  "‌": "", // zero width non-joiner
  "‍": "", // zero width joiner
  "﻿": "", // BOM
  "�": "", // replacement char (인코딩이 깨졌을 때 나오는 물음표 마름모)
};

const REPLACEMENT_PATTERN = new RegExp(
  `[${Object.keys(REPLACEMENTS)
    .map(ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`)
    .join("")}]`,
  "g",
);

export function sanitizeAnswer(text: string) {
  return text
    .replace(REPLACEMENT_PATTERN, ch => REPLACEMENTS[ch] ?? ch)
    // 굵게/기울임/취소선 표시 제거 (내용은 유지)
    .replace(/\*\*\*([\s\S]+?)\*\*\*/g, "$1")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])/g, "$1")
    .replace(/___([\s\S]+?)___/g, "$1")
    .replace(/__([\s\S]+?)__/g, "$1")
    .replace(/~~([\s\S]+?)~~/g, "$1")
    // 코드 표시 제거
    .replace(/```[a-zA-Z]*\n?/g, "")
    .replace(/`([^`\n]+)`/g, "$1")
    // 줄 앞의 마크다운 제목/인용/구분선 기호 제거
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
    .replace(/^[ \t]{0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, "")
    // 불릿 기호는 하이픈으로 통일
    .replace(/^([ \t]*)[*+][ \t]+/gm, "$1- ")
    // 공백 정리
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * 스트리밍용. 전체 원문을 누적해서 매번 정리한 뒤,
 * 이전에 보낸 것보다 늘어난 부분만 돌려줍니다.
 * (조각 단위로 정리하면 `**` 가 두 조각에 걸쳐 있을 때 놓칩니다.)
 */
export function createStreamSanitizer() {
  let raw = "";
  let emitted = "";

  return {
    /** 새 조각을 넣고, 화면에 이어 붙일 문자열을 돌려줍니다(없으면 빈 문자열). */
    push(delta: string) {
      raw += delta;
      const clean = sanitizeAnswer(raw);
      // 정리 결과가 이전 출력과 어긋나면(예: `**` 가 방금 닫혀 별표가 사라진 경우)
      // 조각을 더 보내지 않고, finish() 에서 전문으로 교체하게 둡니다.
      if (!clean.startsWith(emitted)) return "";
      if (clean.length === emitted.length) return "";
      const chunk = clean.slice(emitted.length);
      emitted = clean;
      return chunk;
    },
    /**
     * 스트림 종료 후 최종 전문.
     * replace=true 면 화면에 누적된 내용을 text 로 통째로 갈아끼워야 합니다.
     */
    finish() {
      const clean = sanitizeAnswer(raw).trim();
      if (clean.startsWith(emitted)) {
        return { text: clean, tail: clean.slice(emitted.length), replace: false };
      }
      return { text: clean, tail: "", replace: true };
    },
  };
}
