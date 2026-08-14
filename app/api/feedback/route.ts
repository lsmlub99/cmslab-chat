import { NextResponse } from "next/server";
import { database, hasDatabaseConfig } from "@/lib/database";
import { feedbackSchema } from "@/lib/validation";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ error: ".env.local에 DATABASE_URL을 입력해 주세요." }, { status: 503 });
  }

  let input;
  try {
    input = feedbackSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "피드백 값이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const sql = database();
    const logs = await sql`
      select user_message, bot_answer from public.chat_logs where id = ${input.questionId} limit 1
    `;
    if (!logs.length) return NextResponse.json({ error: "답변 기록을 찾지 못했습니다." }, { status: 404 });

    // 같은 답변에 다시 투표하면 최신 값으로 덮어씁니다(feedback_chat_log_unique 인덱스).
    await sql`
      insert into public.feedback (chat_log_id, user_message, bot_answer, rating, note)
      values (${input.questionId}, ${logs[0].user_message}, ${logs[0].bot_answer},
              ${input.rating === "positive" ? 1 : -1}, ${input.note ?? null})
      on conflict (chat_log_id) do update set
        rating = excluded.rating,
        note = excluded.note,
        created_at = now()
    `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "피드백을 저장하지 못했습니다." },
      { status: 400 },
    );
  }
}
