import { NextResponse } from "next/server";
import { database, hasDatabaseConfig } from "@/lib/database";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 운영 지표. 모든 수치는 public.chat_logs / feedback / documents 실측값입니다.
 *
 * 집계를 SQL에서 하는 이유: postgres.js 는 timestamptz 를 Date 객체로 돌려줍니다.
 * 예전 코드는 created_at.slice(0, 10) 을 호출해 매번 예외가 났습니다.
 * 날짜 버킷팅도 DB의 시간대(Asia/Seoul) 기준으로 맞춰야 "오늘"이 어긋나지 않습니다.
 */
const TIME_ZONE = "Asia/Seoul";

export async function GET(request: Request) {
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ error: ".env.local에 DATABASE_URL을 입력해 주세요." }, { status: 503 });
  }

  try {
    const url = new URL(request.url);
    const days = clampDays(url.searchParams.get("days"));
    const to = parseDate(url.searchParams.get("to")) ?? new Date();
    const from = parseDate(url.searchParams.get("from")) ?? new Date(to.getTime() - (days - 1) * 86_400_000);

    const sql = database();

    const [totals, series, topics, documents] = await Promise.all([
      sql`
        select
          count(*)::int as questions,
          count(*) filter (where is_followup)::int as followups,
          count(*) filter (where not coalesce(is_fallback, false))::int as answered,
          count(*) filter (where coalesce(is_fallback, false))::int as unanswered,
          count(distinct user_id)::int as users,
          count(*) filter (where not coalesce(is_fallback, false) and coalesce(citation_count, 0) > 0)::int as with_citation,
          coalesce(avg(response_ms) filter (where not coalesce(is_fallback, false) and response_ms is not null), 0)::int as avg_response_ms,
          coalesce(avg(top_similarity) filter (where top_similarity is not null), 0)::float8 as avg_similarity
        from public.chat_logs
        where created_at >= ${from} and created_at <= ${to}
      `,
      sql`
        select to_char(day, 'YYYY-MM-DD') as date,
               to_char(day, 'FMMM/FMDD') as label,
               coalesce(counted.questions, 0)::int as questions,
               coalesce(counted.answered, 0)::int as answered
        from generate_series(
               (${from}::timestamptz at time zone ${TIME_ZONE})::date,
               (${to}::timestamptz at time zone ${TIME_ZONE})::date,
               interval '1 day'
             ) as day
        left join (
          select (created_at at time zone ${TIME_ZONE})::date as bucket,
                 count(*) as questions,
                 count(*) filter (where not coalesce(is_fallback, false)) as answered
          from public.chat_logs
          where created_at >= ${from} and created_at <= ${to}
          group by 1
        ) as counted on counted.bucket = day::date
        order by day
      `,
      sql`
        select coalesce(nullif(category, ''), '미분류') as category,
               count(*)::int as questions,
               count(*) filter (where not coalesce(is_fallback, false))::int as answered
        from public.chat_logs
        where created_at >= ${from} and created_at <= ${to}
        group by 1
        order by questions desc, category
        limit 6
      `,
      sql`
        select count(*)::int as chunks,
               count(distinct coalesce(nullif(metadata->>'source_hash', ''), 'doc:' || id::text))::int as documents,
               count(embedding)::int as embedded,
               coalesce(sum(reuse_count), 0)::int as reuse
        from public.documents
      `,
    ]);

    // 피드백에는 기간 컬럼이 있으나 chat_log_id 로 답변과 이어집니다.
    const feedback = await sql`
      select count(*)::int as total,
             count(*) filter (where rating > 0)::int as positive
      from public.feedback
      where created_at >= ${from} and created_at <= ${to}
    `;

    const pending = await sql`
      select count(*)::int as pending from public.chat_logs where coalesce(is_fallback, false)
    `;

    const row = totals[0];
    const questions = Number(row.questions);
    const answered = Number(row.answered);
    const totalFeedback = Number(feedback[0].total);

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        questions,
        followups: Number(row.followups),
        users: Number(row.users),
        answeredRate: percent(answered, questions),
        unansweredRate: percent(Number(row.unanswered), questions),
        reuse: Number(documents[0].reuse),
        citationRate: percent(Number(row.with_citation), answered),
        avgResponseMs: Number(row.avg_response_ms),
        avgSimilarity: Number(Number(row.avg_similarity).toFixed(3)),
        satisfaction: totalFeedback ? percent(Number(feedback[0].positive), totalFeedback) : null,
        feedbackCount: totalFeedback,
        pending: Number(pending[0].pending),
        documents: Number(documents[0].documents),
        chunks: Number(documents[0].chunks),
        embedded: Number(documents[0].embedded),
      },
      series: series.map(item => ({
        date: String(item.date),
        label: String(item.label),
        questions: Number(item.questions),
        answered: Number(item.answered),
      })),
      topics: topics.map(item => ({
        category: String(item.category),
        questions: Number(item.questions),
        answered: Number(item.answered),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "대시보드 데이터를 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}

function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function clampDays(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(365, Math.max(1, Math.round(parsed)));
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
