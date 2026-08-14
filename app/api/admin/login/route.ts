import { NextResponse } from "next/server";
import { createSessionToken, hasAdminPassword, sessionCookie, verifyPassword } from "@/lib/auth";
import { rateLimit, requesterKey } from "@/lib/rate-limit";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 비밀번호 무차별 대입을 막습니다. 5분에 8회.
 * 성공해도 카운트는 그대로 둡니다 — 성공 시 리셋하면 맞는 비밀번호 하나를 섞어
 * 카운터를 계속 초기화하는 우회가 생깁니다.
 */
const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 5 * 60;

export async function POST(request: Request) {
  if (!hasAdminPassword()) {
    return NextResponse.json(
      { error: ".env.local에 ADMIN_PASSWORD를 설정해 주세요.", setupRequired: true },
      { status: 503 },
    );
  }

  const limit = await rateLimit(`admin-login:${requesterKey(request)}`, MAX_ATTEMPTS, WINDOW_SECONDS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `시도가 너무 많습니다. ${limit.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => ({}));
  if (!(await verifyPassword(body?.password))) {
    return NextResponse.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set(
    "Set-Cookie",
    sessionCookie(await createSessionToken(), new URL(request.url).protocol === "https:"),
  );
  return response;
}
