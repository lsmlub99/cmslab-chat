import { NextResponse } from "next/server";
import { database, hasDatabaseConfig } from "@/lib/database";
import { defaultSettings, getSettings } from "@/lib/settings";
import { listConversations, readUserCookie } from "@/lib/conversations";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * 채팅 첫 화면이 필요한 것을 한 번에 돌려줍니다.
 *
 * 왜 합쳤나: 예전에는 화면이 뜨자마자 settings / dashboard / unanswered / conversations
 * 4개를 각각 호출했습니다. 서버리스에서는 이게 함수 4개를 동시에 깨우는 셈이라
 * 콜드 스타트가 4번 겹치고, 각자 DB 커넥션을 새로 열었습니다.
 * 실제로 다른 사용자가 처음 접속했을 때 대시보드가 10초 제한에 걸려 504가 났고
 * 화면의 수치가 전부 비어 보였습니다.
 *
 * 하나로 합치면 커넥션 하나를 공유하며 쿼리만 병렬로 돌릴 수 있습니다.
 * 부분 실패에도 화면이 통째로 죽지 않도록 각 항목을 독립적으로 처리합니다.
 */
export async function GET(request: Request) {
  const userId = readUserCookie(request);

  if (!hasDatabaseConfig()) {
    return NextResponse.json({
      settings: defaultSettings(),
      stats: null,
      unanswered: [],
      conversations: [],
      error: "DATABASE_URL이 설정되지 않았습니다.",
    });
  }

  const sql = database();
  const since = new Date(Date.now() - 6 * 86_400_000);

  const [settings, stats, unanswered, conversations] = await Promise.all([
    getSettings().catch(() => defaultSettings()),

    // 첫 화면 카드에 필요한 수치만 뽑습니다. 대시보드 전체 집계보다 훨씬 가볍습니다.
    sql`
      select
        (select count(*)::int from public.chat_logs where created_at >= ${since}) as questions,
        (select count(*)::int from public.chat_logs where created_at >= ${since} and is_followup) as followups,
        (select count(*)::int from public.chat_logs where created_at >= ${since}
           and not coalesce(is_fallback, false)) as answered,
        (select count(*)::int from public.chat_logs where coalesce(is_fallback, false)) as pending,
        (select coalesce(sum(reuse_count), 0)::int from public.documents) as reuse,
        (select count(*)::int from public.documents) as chunks,
        (select count(distinct coalesce(nullif(metadata->>'source_hash', ''), 'doc:' || id::text))::int
           from public.documents) as documents
    `.then(rows => rows[0]).catch(() => null),

    sql`
      select id, user_message as question, created_at, user_id
      from public.chat_logs
      where coalesce(is_fallback, false)
      order by created_at desc
      limit 4
    `.catch(() => []),

    userId ? listConversations(userId, 30).catch(() => []) : Promise.resolve([]),
  ]);

  const topics = await sql`
    select coalesce(nullif(category, ''), '미분류') as category,
           count(*)::int as questions,
           count(*) filter (where not coalesce(is_fallback, false))::int as answered
    from public.chat_logs
    where created_at >= ${since}
    group by 1 order by questions desc, category limit 5
  `.catch(() => []);

  const questions = Number(stats?.questions ?? 0);
  const answered = Number(stats?.answered ?? 0);

  return NextResponse.json({
    settings,
    stats: stats
      ? {
          questions,
          followups: Number(stats.followups),
          answeredRate: questions ? Math.round((answered / questions) * 100) : 0,
          unansweredRate: questions ? Math.round(((questions - answered) / questions) * 100) : 0,
          reuse: Number(stats.reuse),
          pending: Number(stats.pending),
          documents: Number(stats.documents),
          chunks: Number(stats.chunks),
        }
      : null,
    topics: topics.map(row => ({
      category: String(row.category),
      questions: Number(row.questions),
      answered: Number(row.answered),
    })),
    unanswered: (unanswered as Record<string, unknown>[]).map(row => ({
      id: Number(row.id),
      question: String(row.question),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
      user_key: row.user_id ? String(row.user_id).slice(0, 6) : null,
      top_similarity: null,
    })),
    conversations,
  });
}
