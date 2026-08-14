import { NextResponse } from "next/server";
import { authorizeUrl, createState, hasGoogleConfig, stateCookie } from "@/lib/google-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 구글 로그인 시작. 서명한 state 를 쿠키에 남기고 구글로 보냅니다. */
export async function GET(request: Request) {
  const url = new URL(request.url);

  if (!hasGoogleConfig()) {
    return NextResponse.redirect(new URL("/login?error=setup", url.origin));
  }

  const returnTo = url.searchParams.get("next") || "/";
  const state = await createState(returnTo);
  const redirectUri = `${url.origin}/api/auth/callback`;

  const response = NextResponse.redirect(authorizeUrl(redirectUri, state));
  response.headers.set("Set-Cookie", stateCookie(state, url.protocol === "https:"));
  return response;
}
