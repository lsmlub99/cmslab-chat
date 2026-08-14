import { NextResponse } from "next/server";
import { hasAdminPassword, readAdminCookie, verifySessionToken } from "@/lib/auth";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

/** 관리자 화면이 로그인 상태를 확인할 때 씁니다. */
export async function GET(request: Request) {
  return NextResponse.json({
    authenticated: await verifySessionToken(readAdminCookie(request)),
    setupRequired: !hasAdminPassword(),
  });
}
