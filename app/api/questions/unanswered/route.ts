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
             user_id as user_key,
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
        // user_id 는 쿠키로 발급한 익명 식별자입니다. 화면에는 앞 6자만 보여 줍니다.
        user_key: row.user_key ? String(row.user_key).slice(0, 6) : null,
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
