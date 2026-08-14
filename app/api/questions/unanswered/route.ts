import { NextResponse } from "next/server";
import { database, hasDatabaseConfig } from "@/lib/database";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ error: ".env.local에 DATABASE_URL을 입력해 주세요." }, { status: 503 });
  }
  try {
    const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 50));
    const rows = await database()`
      select id,
             user_message as question,
             created_at,
             user_id,
             user_name,
             user_email,
             conversation_id,
             top_similarity
      from public.chat_logs
      where coalesce(is_fallback, false)
      order by created_at desc
      limit ${limit}
    `;
    return NextResponse.json(
      rows.map(row => ({
        id: Number(row.id),
        question: String(row.question),
        created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
        // 로그인 사용자는 실명으로 보여 줍니다. 관리자가 직접 확인할 수 있어야
        // 미답변 → 지식 등록 흐름이 돌아갑니다.
        // 로그인 도입 전 기록은 쿠키 식별자뿐이라 앞 6자만 표시합니다.
        user_key: row.user_name
          ? String(row.user_name)
          : row.user_id ? `익명 ${String(row.user_id).slice(0, 6)}` : null,
        user_email: row.user_email ? String(row.user_email) : null,
        top_similarity: row.top_similarity === null ? null : Number(row.top_similarity),
      })),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "미답변 질문을 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}
