import { NextResponse } from "next/server";
import { database, hasDatabaseConfig } from "@/lib/database";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 함수와 DB 커넥션을 깨워 두기 위한 엔드포인트입니다.
 *
 * 서버리스는 요청이 없으면 인스턴스가 사라지고, 다음 접속자가 함수 기동 +
 * Supabase TLS 핸드셰이크 비용을 전부 부담합니다. 외부에서 주기적으로 이걸
 * 호출해 두면 첫 사용자가 기다리지 않습니다.
 *
 * 일부러 가볍게 만들었습니다 — 커넥션만 살아 있으면 되므로 select 1 만 합니다.
 */
export async function GET() {
  const started = Date.now();

  if (!hasDatabaseConfig()) {
    return NextResponse.json({ ok: false, reason: "DATABASE_URL 미설정" }, { status: 503 });
  }

  try {
    await database()`select 1`;
    return NextResponse.json(
      { ok: true, ms: Date.now() - started },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : "연결 실패" },
      { status: 503 },
    );
  }
}
