import { NextResponse } from "next/server";
import { hasDatabaseConfig } from "@/lib/database";
import { defaultSettings, getSettings } from "@/lib/settings";
import { listConversations, readUserCookie } from "@/lib/conversations";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 채팅 첫 화면이 필요한 것을 한 번에 돌려줍니다.
 *
 * 사용자 화면에는 챗봇 설정(이름·인사말)과 본인의 지난 대화 목록만 있으면 됩니다.
 * 질문 수나 재사용 횟수 같은 운영 지표는 관리자 화면(KPI)으로 옮겼습니다.
 * 사용자에게는 쓸모없는 숫자였고, 집계 쿼리가 첫 화면을 느리게 만들었습니다.
 *
 * 예전에는 화면이 뜨자마자 API 4개를 각각 호출했습니다. 서버리스에서는
 * 잠든 함수 4개를 동시에 깨우는 셈이라 콜드 스타트가 겹쳐 첫 접속이 실패했습니다.
 */
export async function GET(request: Request) {
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ settings: defaultSettings(), conversations: [] });
  }

  const userId = readUserCookie(request);

  const [settings, conversations] = await Promise.all([
    getSettings().catch(() => defaultSettings()),
    // 쿠키가 없으면 아직 질문한 적이 없는 사용자입니다. 쿼리를 아낍니다.
    userId ? listConversations(userId, 30).catch(() => []) : Promise.resolve([]),
  ]);

  return NextResponse.json(
    { settings, conversations },
    { headers: { "Cache-Control": "no-store" } },
  );
}
