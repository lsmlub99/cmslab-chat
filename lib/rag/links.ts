/**
 * 답변 본문에서 URL을 찾아 조각으로 나눕니다.
 *
 * 사내 문서에는 구글 문서·스프레드시트 링크가 많아 답변에 URL이 자주 등장합니다.
 * 화면은 마크다운을 렌더링하지 않으므로(서버에서 서식 기호를 걷어냅니다)
 * 그대로 두면 주소가 글자로만 남아 복사해서 붙여야 합니다.
 * 여기서 나눈 조각을 화면이 링크로 그립니다.
 */

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g;
// 문장 끝의 부호까지 주소에 삼키지 않도록 잘라냅니다.
const TRAILING = /[.,!?)\]}"'·:;]+$/;

export type TextPiece = { text: string; href?: string };

/**
 * 근거 문서에서 URL을 뽑습니다.
 *
 * 왜 필요한가: 모델이 답변에 URL을 옮겨 적으면 긴 무작위 문자열을 중간에서
 * 잘라먹습니다. 실제로 구글 문서 ID 44자가 27자에서 끊긴 링크가 답변에 나왔고,
 * 누르면 열리지 않았습니다. 링크는 모델이 아니라 데이터에서 가져와야 정확합니다.
 */
export function extractUrls(text: string) {
  const urls = new Set<string>();
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const trailing = raw.match(TRAILING)?.[0] ?? "";
    const url = trailing ? raw.slice(0, -trailing.length) : raw;
    // 청크 경계에서 잘린 조각(스킴만 남은 것 등)은 버립니다.
    if (url.length > 12 && /^https?:\/\/[^/]+\./.test(url)) urls.add(url);
  }
  return [...urls];
}

export function splitLinks(input: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) pieces.push({ text: input.slice(lastIndex, start) });

    const raw = match[0];
    const trailing = raw.match(TRAILING)?.[0] ?? "";
    const href = trailing ? raw.slice(0, -trailing.length) : raw;

    if (href) pieces.push({ text: href, href });
    if (trailing) pieces.push({ text: trailing });

    lastIndex = start + raw.length;
  }

  if (lastIndex < input.length) pieces.push({ text: input.slice(lastIndex) });
  return pieces;
}
