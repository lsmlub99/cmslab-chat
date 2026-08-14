import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { chatSchema } from "@/lib/validation";
import { hasOpenAIConfig } from "@/lib/openai";
import { buildSearchQuery, HISTORY_TURNS, isEmptyAnswer, saysInsufficient, streamAnswer } from "@/lib/rag/answer";
import { createStreamSanitizer } from "@/lib/rag/sanitize";
import { listTurns } from "@/lib/conversations";
import { readSession, readSessionCookie } from "@/lib/google-auth";
import { CHAT_LIMIT, CHAT_WINDOW_SECONDS, rateLimit, requesterKey } from "@/lib/rate-limit";
import { MATCH_COUNT, TOP_MATCH_THRESHOLD } from "@/lib/rag/config";
import {
  documentTitle,
  incrementReuse,
  isStrongMatch,
  searchDocuments,
  searchWithExpansion,
  type SearchRow,
} from "@/lib/existing-db";
import { extractUrls } from "@/lib/rag/links";
import { BLOCKED_MESSAGE, checkQuestion } from "@/lib/rag/moderation";
import { database, hasDatabaseConfig } from "@/lib/database";
import type { Citation } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const FALLBACK_ANSWER =
  "등록된 팀 지식에서 확인되지 않는 내용입니다. 관리자에게 질문을 전달했으니 확인 후 지식으로 등록될 예정입니다.";

type ChatLogInput = {
  question: string;
  answer: string;
  category: string;
  fallback: boolean;
  actor: string;
  /** 로그인 사용자일 때만 채워집니다. 관리자가 미답변 질문의 주인을 찾을 때 씁니다. */
  email: string | null;
  name: string | null;
  conversationId: string;
  responseMs: number;
  followup: boolean;
  citationCount: number;
  topSimilarity: number | null;
};

async function insertChatLog(input: ChatLogInput) {
  const sql = database();
  const rows = await sql`
    insert into public.chat_logs
      (user_message, bot_answer, category, is_fallback, user_id, user_email, user_name,
       conversation_id, response_ms, is_followup, citation_count, top_similarity)
    values
      (${input.question}, ${input.answer}, ${input.category}, ${input.fallback}, ${input.actor},
       ${input.email}, ${input.name}, ${input.conversationId}, ${input.responseMs},
       ${input.followup}, ${input.citationCount}, ${input.topSimilarity})
    returning id
  `;
  return Number(rows[0].id);
}

async function insertCitations(chatLogId: number, citations: Citation[]) {
  if (!citations.length) return;
  const sql = database();
  await sql`
    insert into public.chat_log_citations ${sql(
      citations.map((citation, index) => ({
        chat_log_id: chatLogId,
        document_id: citation.id,
        position: index,
        title: citation.title,
        source_url: citation.sourceUrl ?? null,
        similarity: citation.similarity ?? null,
      })),
      "chat_log_id",
      "document_id",
      "position",
      "title",
      "source_url",
      "similarity",
    )}
  `;
}

/** 근거 청크에 들어 있는 링크를 문서 제목과 함께 모읍니다(중복 제거). */
function collectLinks(rows: SearchRow[]) {
  const seen = new Map<string, { url: string; title: string }>();
  for (const row of rows) {
    const title = documentTitle(row.metadata);
    for (const url of extractUrls(row.content)) {
      if (!seen.has(url)) seen.set(url, { url, title });
    }
    // 링크가 너무 많으면 화면이 지저분해집니다.
    if (seen.size >= 5) break;
  }
  return [...seen.values()].slice(0, 5);
}

function toCitations(rows: SearchRow[]): Citation[] {
  return rows.map(row => ({
    id: row.id,
    title: documentTitle(row.metadata),
    sourceUrl: row.metadata.source_url ? String(row.metadata.source_url) : undefined,
    page: row.metadata.page ? Number(row.metadata.page) : undefined,
    similarity: Number(row.similarity.toFixed(4)),
  }));
}

export async function POST(request: Request) {
  const started = Date.now();

  let question = "";
  let conversationId: string | undefined;
  let userId: string | undefined;
  try {
    ({ question, conversationId, userId } = chatSchema.parse(await request.json()));
  } catch {
    return NextResponse.json({ error: "질문을 입력해 주세요." }, { status: 400 });
  }

  if (!hasOpenAIConfig()) {
    return NextResponse.json({ error: ".env.local에 OPENAI_API_KEY를 입력해 주세요.", setupRequired: true }, { status: 503 });
  }
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ error: ".env.local에 DATABASE_URL을 입력해 주세요.", setupRequired: true }, { status: 503 });
  }

  const activeConversation = conversationId || randomUUID();
  const followup = Boolean(conversationId);

  /*
   * 사용자 식별.
   * 로그인했으면 구글 계정 ID(sub)를 씁니다 — 기기를 바꿔도 값이 같아서
   * "사용자 수" 지표가 사람 단위로 집계되고 대화 기록도 따라옵니다.
   * 로그인 설정 전에는 예전처럼 익명 쿠키로 물러섭니다.
   */
  const session = await readSession(readSessionCookie(request));
  const cookieUser = request.headers.get("cookie")?.match(/(?:^|;\s*)answerbot_user=([^;]+)/)?.[1];
  const actor = session?.id || userId || cookieUser || randomUUID();
  const setUserCookie = session || cookieUser
    ? ""
    : `answerbot_user=${actor}; Path=/; Max-Age=31536000; SameSite=Lax`;

  /*
   * 욕설·비방·성적 표현은 검색과 모델 호출 전에 걸러 냅니다.
   * 기록은 남기되 category 를 blocked 로 두어, 미답변 대기열과 지표에서 제외합니다.
   * 지식이 없어서 못 답한 것이 아니므로 관리자가 채워야 할 문서가 아닙니다.
   */
  const moderation = await checkQuestion(question);
  if (moderation.blocked) {
    try {
      await insertChatLog({
        question,
        answer: BLOCKED_MESSAGE,
        category: "blocked",
        fallback: false,
        actor,
        email: session?.email ?? null,
        name: session?.name ?? null,
        conversationId: activeConversation,
        responseMs: Date.now() - started,
        followup,
        citationCount: 0,
        topSimilarity: null,
      });
    } catch {
      // 기록 실패가 차단을 막아서는 안 됩니다.
    }
    const response = NextResponse.json({
      answer: BLOCKED_MESSAGE,
      citations: [],
      conversationId: activeConversation,
      blocked: true,
    });
    if (setUserCookie) response.headers.set("Set-Cookie", setUserCookie);
    return response;
  }

  // 질문 연발로 OpenAI 과금이 튀는 것을 막습니다.
  const limit = await rateLimit(requesterKey(request, session?.id || cookieUser), CHAT_LIMIT(), CHAT_WINDOW_SECONDS());
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `질문이 너무 빠릅니다. ${limit.retryAfter}초 후 다시 시도해 주세요.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  try {
    // 이어지는 질문이면 앞선 대화를 불러와 검색과 답변에 함께 사용합니다.
    const history = followup
      ? (await listTurns(activeConversation, actor))
          .filter(turn => !turn.isFallback)
          .slice(-HISTORY_TURNS)
          .map(turn => ({ question: turn.question, answer: turn.answer }))
      : [];

    const searchQuery = buildSearchQuery(question, history);
    let rows = await searchDocuments(searchQuery, MATCH_COUNT);

    /*
     * 근거를 못 찾았으면 포기하기 전에 한 번 더 시도합니다.
     * 모델이 동의어를 넓혀 주면 사전에 없던 낱말도 걸립니다.
     * 잘 찾은 질문에는 이 경로가 실행되지 않으므로 평소 속도는 그대로입니다.
     */
    if (!rows.some(row => isStrongMatch(row, TOP_MATCH_THRESHOLD))) {
      const retried = await searchWithExpansion(searchQuery, MATCH_COUNT);
      if (retried.some(row => isStrongMatch(row, TOP_MATCH_THRESHOLD))) rows = retried;
    }
    // rankAndTrim 이 유사도 내림차순으로 정렬해 두므로 첫 행이 최고 유사도입니다.
    const topSimilarity = rows.length ? rows[0].similarity : null;

    /*
     * 여기서의 판정은 "확실히 아무것도 없는" 질문에 대해 모델 호출을 아끼는 용도입니다.
     * 코사인 값만으로 무관한 질문을 걸러낼 수는 없습니다 — 실측에서 정답 문서가 0.29,
     * 무관한 질문이 0.32 로 구간이 겹칩니다. 그래서 최종 관련성 판단은 모델에게 맡기고
     * (모델이 "근거가 부족합니다"로 답하면 아래에서 미답변으로 돌립니다) 이 관문은
     * 느슨하게 둡니다.
     */
    const tooWeak = !rows.some(row => isStrongMatch(row, TOP_MATCH_THRESHOLD));

    if (tooWeak) {
      const questionId = await insertChatLog({
        question,
        answer: FALLBACK_ANSWER,
        category: "fallback",
        fallback: true,
        actor,
        email: session?.email ?? null,
        name: session?.name ?? null,
        conversationId: activeConversation,
        responseMs: Date.now() - started,
        followup,
        citationCount: 0,
        topSimilarity,
      });
      const response = NextResponse.json({
        answer: FALLBACK_ANSWER,
        citations: [],
        conversationId: activeConversation,
        questionId,
        unanswered: true,
      });
      if (setUserCookie) response.headers.set("Set-Cookie", setUserCookie);
      return response;
    }

    const citations = toCitations(rows);

    /*
     * 관련 링크는 근거 문서에서 직접 뽑습니다.
     * 모델에게 URL을 받아쓰게 하면 긴 문서 ID를 중간에서 잘라먹어
     * 열리지 않는 링크가 됩니다(실제로 44자 ID가 27자에서 끊겼습니다).
     */
    const links = collectLinks(rows);

    const stream = await streamAnswer(question, citations, rows, history);

    const encoder = new TextEncoder();
    const sanitizer = createStreamSanitizer();
    // 사용자가 중단하거나 창을 닫았을 때 로그를 두 번 쓰지 않기 위한 표시입니다.
    let settled = false;

    const readable = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) =>
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

        send("meta", { conversationId: activeConversation, citations, links });

        try {
          for await (const event of stream) {
            if (event.type === "response.output_text.delta") {
              const chunk = sanitizer.push(event.delta);
              if (chunk) send("delta", { text: chunk });
            } else if (event.type === "response.failed" || event.type === "response.incomplete") {
              throw new Error("모델이 답변을 완료하지 못했습니다.");
            }
          }

          const { text: answer, tail, replace } = sanitizer.finish();

          /*
           * 모델이 아무것도 내놓지 않은 경우는 지식 공백이 아니라 일시적인 오류입니다.
           * 기록으로 남기면 답변 가능한 질문이 미답변 대기열에 쌓이므로 남기지 않고
           * 재시도를 안내합니다.
           */
          if (isEmptyAnswer(answer)) {
            settled = true;
            send("error", { message: "답변을 생성하지 못했습니다. 다시 한번 질문해 주세요." });
            return;
          }

          if (replace) send("replace", { text: answer });
          else if (tail) send("delta", { text: tail });

          settled = true;

          // 모델이 "근거가 부족합니다"로 답하면 인용을 붙이지 않고 미답변으로 넘깁니다.
          const insufficient = saysInsufficient(answer);
          const finalAnswer = insufficient ? FALLBACK_ANSWER : answer;
          const finalCitations = insufficient ? [] : citations;

          const logId = await insertChatLog({
            question,
            answer: finalAnswer,
            category: insufficient ? "fallback" : String(rows[0].metadata.category || "general"),
            fallback: insufficient,
            actor,
        email: session?.email ?? null,
        name: session?.name ?? null,
            conversationId: activeConversation,
            responseMs: Date.now() - started,
            followup,
            citationCount: finalCitations.length,
            topSimilarity,
          });

          if (finalCitations.length) {
            await insertCitations(logId, finalCitations);
            await incrementReuse([...new Set(finalCitations.map(citation => citation.id))]);
          }

          send("done", {
            questionId: logId,
            citations: finalCitations,
            // 근거를 쓰지 않은 답변에는 링크도 붙이지 않습니다.
            links: insufficient ? [] : links,
            unanswered: insufficient,
            ...(insufficient ? { answer: FALLBACK_ANSWER } : {}),
          });
        } catch (error) {
          settled = true;
          send("error", { message: error instanceof Error ? error.message : "답변 생성에 실패했습니다." });
        } finally {
          controller.close();
        }
      },

      /**
       * 사용자가 "중단"을 누르거나 브라우저가 연결을 끊으면 호출됩니다.
       * 모델 호출을 즉시 끊어 토큰을 더 쓰지 않게 하고,
       * 여기까지 나온 답변은 기록으로 남겨 대화 내역이 비지 않게 합니다.
       */
      async cancel() {
        stream.controller.abort();
        if (settled) return;
        settled = true;

        const { text } = sanitizer.finish();
        if (!text) return;

        try {
          const logId = await insertChatLog({
            question,
            answer: `${text}\n\n(사용자가 답변 생성을 중단했습니다.)`,
            category: String(rows[0].metadata.category || "general"),
            fallback: false,
            actor,
        email: session?.email ?? null,
        name: session?.name ?? null,
            conversationId: activeConversation,
            responseMs: Date.now() - started,
            followup,
            citationCount: citations.length,
            topSimilarity,
          });
          await insertCitations(logId, citations);
        } catch {
          // 중단 처리 중의 기록 실패는 사용자에게 알릴 방법이 없습니다. 조용히 넘어갑니다.
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...(setUserCookie ? { "Set-Cookie": setUserCookie } : {}),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "질문을 처리하지 못했습니다." },
      { status: 500 },
    );
  }
}
