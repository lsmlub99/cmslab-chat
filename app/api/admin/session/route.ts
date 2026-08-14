import { NextResponse } from "next/server";
import { hasAdminPassword, readAdminCookie, verifySessionToken } from "@/lib/auth";

/** 관리자 화면이 로그인 상태를 확인할 때 씁니다. */
export async function GET(request: Request) {
  return NextResponse.json({
    authenticated: await verifySessionToken(readAdminCookie(request)),
    setupRequired: !hasAdminPassword(),
  });
}
