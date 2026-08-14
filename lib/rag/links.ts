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
