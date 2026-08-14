import { NextResponse } from "next/server";
import { database, hasDatabaseConfig } from "@/lib/database";
import { defaultSettings, getSettings } from "@/lib/settings";
import { currentUserId, listConversations } from "@/lib/conversations";
import { readSession, readSessionCookie } from "@/lib/google-auth";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

/** 첫 화면 추천 질문 — 자료가 없을 때 쓰는 기본값입니다. */
const FALLBACK_SUGGESTIONS = [
  "연차 휴가는 어떻게 신청하나요?",
  "경조사 지원금 얼마 나와요?",
  "노트북이 고장났는데 어디에 요청하나요?",
  "재직증명서는 어디서 발급받나요?",
];

/**
 * 채팅 첫 화면이 필요한 것을 한 번에 돌려줍니다.
 *
 * 사용자 화면에는 챗봇 설정, 로그인한 사람, 본인의 지난 대화만 있으면 됩니다.
 * 질문 수나 재사용 횟수 같은 운영 지표는 관리자 KPI 화면으로 옮겼습니다.
 *
 * 추천 질문은 팀에서 실제로 많이 물어보고 답변에 성공한 질문에서 뽑습니다.
 * 지어낸 예시보다 실제로 답이 나오는 질문을 보여 주는 편이 낫습니다.
 */
export async function GET(request: Request) {
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ settings: defaultSettings(), user: null, conversations: [], suggestions: FALLBACK_SUGGESTIONS });
  }

  const session = await readSession(readSessionCookie(request));
  const userId = session?.id ?? (await currentUserId(request));
  const sql = database();

  const [settings, conversations, popular] = await Promise.all([
    getSettings().catch(() => defaultSettings()),
    userId ? listConversations(userId, 30).catch(() => []) : Promise.resolve([]),
    sql`
      select user_message as question, count(*)::int as asked
      from public.chat_logs
      where not coalesce(is_fallback, false)
        and created_at >= now() - interval '60 days'
        and char_length(user_message) between 6 and 60
      group by user_message
      order by asked desc, max(created_at) desc
      limit 4
    `.catch(() => []),
  ]);

  const suggestions = popular.length >= 3
    ? popular.map(row => String(row.question))
    : FALLBACK_SUGGESTIONS;

  return NextResponse.json(
    {
      settings,
      user: session ? { name: session.name, email: session.email, picture: session.picture } : null,
      conversations,
      suggestions,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
