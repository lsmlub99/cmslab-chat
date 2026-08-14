import { NextResponse } from "next/server";
import { database, hasDatabaseConfig } from "@/lib/database";

/**
 * 대화·답변 기록. 관리자 화면의 "대화 기록" 탭이 사용합니다.
 * 답변에 붙은 출처와 피드백 결과를 함께 묶어 돌려줍니다.
 */
export async function GET(request: Request) {
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ error: ".env.local에 DATABASE_URL을 입력해 주세요." }, { status: 503 });
  }

  try {
    const params = new URL(request.url).searchParams;
    const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
    const filter = params.get("filter"); // all | answered | unanswered

    const sql = database();
    const rows = await sql`
      select l.id,
             l.user_message,
             l.bot_answer,
             l.category,
             coalesce(l.is_fallback, false) as is_fallback,
             l.is_followup,
             l.response_ms,
             l.citation_count,
             l.top_similarity,
             l.conversation_id,
             l.user_id,
             l.created_at,
             f.rating as feedback_rating,
             coalesce(c.citations, '[]'::json) as citations
      from public.chat_logs l
      left join public.feedback f on f.chat_log_id = l.id
      left join (
        select chat_log_id,
               json_agg(json_build_object(
                 'id', document_id, 'title', title, 'sourceUrl', source_url, 'similarity', similarity
               ) order by position) as citations
        from public.chat_log_citations
        group by chat_log_id
      ) c on c.chat_log_id = l.id
      where ${
        filter === "answered" ? sql`not coalesce(l.is_fallback, false)`
        : filter === "unanswered" ? sql`coalesce(l.is_fallback, false)`
        : sql`true`
      }
      order by l.created_at desc
      limit ${limit}
    `;

    return NextResponse.json(
      rows.map(row => ({
        id: Number(row.id),
        question: String(row.user_message),
        answer: String(row.bot_answer),
        category: row.category ? String(row.category) : null,
        isFallback: Boolean(row.is_fallback),
        isFollowup: Boolean(row.is_followup),
        responseMs: row.response_ms === null ? null : Number(row.response_ms),
        citationCount: Number(row.citation_count ?? 0),
        topSimilarity: row.top_similarity === null ? null : Number(row.top_similarity),
        conversationId: row.conversation_id ? String(row.conversation_id) : null,
        userKey: row.user_id ? String(row.user_id).slice(0, 6) : null,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
        feedback: row.feedback_rating === null ? null : Number(row.feedback_rating) > 0 ? "positive" : "negative",
        citations: Array.isArray(row.citations) ? row.citations : [],
      })),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "대화 기록을 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}
