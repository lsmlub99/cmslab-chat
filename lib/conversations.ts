import { database } from "@/lib/database";
import { readSession, readSessionCookie } from "@/lib/google-auth";
import type { Citation } from "@/lib/types";

export type ConversationTurn = {
  id: number;
  question: string;
  answer: string;
  isFallback: boolean;
  createdAt: string;
  citations: Citation[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  turns: number;
  lastMessageAt: string;
  hasUnanswered: boolean;
};

/**
 * 요청자의 사용자 식별자.
 *
 * 로그인 도입 후에는 구글 계정 ID(sub)를 씁니다. 사람마다 값이 고정되므로
 * 기기를 바꾸거나 쿠키를 지워도 자기 대화 기록을 그대로 봅니다.
 * 로그인 설정 전이거나 세션이 없으면 예전 익명 쿠키로 물러섭니다.
 */
export async function currentUserId(request: Request) {
  const session = await readSession(readSessionCookie(request));
  if (session) return session.id;
  return request.headers.get("cookie")?.match(/(?:^|;\s*)answerbot_user=([^;]+)/)?.[1] ?? "";
}

/**
 * 한 대화의 주고받은 내역을 시간순으로 돌려줍니다.
 * chat_logs 한 행이 질문 1 + 답변 1 이므로 행을 그대로 turn 으로 씁니다.
 */
export async function listTurns(conversationId: string, userId?: string): Promise<ConversationTurn[]> {
  const sql = database();
  const rows = await sql`
    select l.id, l.user_message, l.bot_answer, coalesce(l.is_fallback, false) as is_fallback, l.created_at,
           coalesce(c.citations, '[]'::json) as citations
    from public.chat_logs l
    left join (
      select chat_log_id,
             json_agg(json_build_object(
               'id', document_id, 'title', title, 'sourceUrl', source_url, 'similarity', similarity
             ) order by position) as citations
      from public.chat_log_citations
      group by chat_log_id
    ) c on c.chat_log_id = l.id
    where l.conversation_id = ${conversationId}
      -- userId 를 넘기면 남의 대화를 열지 못하게 막습니다.
      and (${userId ?? null}::text is null or l.user_id = ${userId ?? null})
    order by l.created_at, l.id
  `;

  return rows.map(row => ({
    id: Number(row.id),
    question: String(row.user_message),
    answer: String(row.bot_answer),
    isFallback: Boolean(row.is_fallback),
    createdAt: toIso(row.created_at),
    citations: Array.isArray(row.citations) ? (row.citations as Citation[]) : [],
  }));
}

/** 한 사용자의 대화 목록. 제목은 첫 질문을 줄여서 씁니다. */
export async function listConversations(userId: string, limit = 30): Promise<ConversationSummary[]> {
  const sql = database();
  const rows = await sql`
    select conversation_id as id,
           count(*)::int as turns,
           max(created_at) as last_message_at,
           bool_or(coalesce(is_fallback, false)) as has_unanswered,
           (array_agg(user_message order by created_at, id))[1] as title
    from public.chat_logs
    where user_id = ${userId} and conversation_id is not null
    group by conversation_id
    order by max(created_at) desc
    limit ${limit}
  `;

  return rows.map(row => ({
    id: String(row.id),
    title: String(row.title ?? "새 대화").slice(0, 60),
    turns: Number(row.turns),
    lastMessageAt: toIso(row.last_message_at),
    hasUnanswered: Boolean(row.has_unanswered),
  }));
}

export async function deleteConversation(conversationId: string, userId: string) {
  const sql = database();
  const removed = await sql`
    delete from public.chat_logs
    where conversation_id = ${conversationId} and user_id = ${userId}
    returning id
  `;
  return removed.length;
}

function toIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : "";
}
