import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/settings";
import { logUserAction } from "@/lib/server/telemetry.server";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function PATCH(request: Request) {
  try {
    const saved = await saveSettings(await request.json());
    // 사용 기록: 설정 값 자체는 보내지 않습니다.
    await logUserAction({ action: "update_settings", success: true }).catch(() => undefined);
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "설정을 저장하지 못했습니다." },
      { status: 503 },
    );
  }
}
