import { NextResponse } from "next/server";
import {
  clearedStateCookie,
  createSession,
  exchangeCode,
  readState,
  readStateCookie,
  sessionCookie,
} from "@/lib/google-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 구글이 돌려보낸 인가 코드를 세션으로 바꿉니다.
 *
 * 확인 순서
 *  1) 사용자가 취소했는지
 *  2) state 가 우리가 발급한 것과 같은지(CSRF 방지)
 *  3) 코드 교환이 되는지, 회사 도메인 계정인지
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";

  const fail = (reason: string) => {
    const response = NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin));
    response.headers.set("Set-Cookie", clearedStateCookie(secure));
    return response;
  };

  if (url.searchParams.get("error")) return fail("cancelled");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("invalid");

  // 돌아온 state 가 쿠키에 남겨 둔 값과 같아야 합니다.
  if (state !== readStateCookie(request)) return fail("state");

  const parsed = await readState(state);
  if (!parsed) return fail("expired");

  const user = await exchangeCode(code, `${url.origin}/api/auth/callback`);
  // 회사 도메인이 아니면 여기서 걸립니다.
  if (!user) return fail("domain");

  const response = NextResponse.redirect(new URL(parsed.returnTo, url.origin));
  response.headers.append("Set-Cookie", sessionCookie(await createSession(user), secure));
  response.headers.append("Set-Cookie", clearedStateCookie(secure));
  return response;
}
