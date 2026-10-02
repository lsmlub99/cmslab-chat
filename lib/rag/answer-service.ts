import "server-only";

import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import {
  documentTitle,
  incrementReuse,
  isStrongMatch,
  searchDocuments,
  searchWithExpansion,
  type SearchRow,
} from "@/lib/existing-db";
import { chatModel } from "@/lib/openai";
import { buildSearchQuery, isEmptyAnswer, saysInsufficient, streamAnswer, type HistoryTurn } from "@/lib/rag/answer";
import { errorCodeOf } from "@/lib/rag/ai-error";
import { MATCH_COUNT, TOP_MATCH_THRESHOLD } from "@/lib/rag/config";
import { extractUrls } from "@/lib/rag/links";
import { BLOCKED_MESSAGE, checkQuestion } from "@/lib/rag/moderation";
import { sanitizeAnswer } from "@/lib/rag/sanitize";
import { logAiCall, logUserAction } from "@/lib/server/telemetry.server";
import type { Citation } from "@/lib/types";

export const FALLBACK_ANSWER =
  "등록된 팀 지식에서 확인되지 않는 내용입니다. 관리자에게 질문을 전달했으니 확인 후 지식으로 등록될 예정입니다.";

export type KnowledgeAnswerStatus = "answered" | "insufficient" | "blocked";

export type KnowledgeAnswerResult = {
  status: KnowledgeAnswerStatus;
  answer: string;
  citations: Citation[];
  links: { url: string; title: string }[];
  questionId: number;
  conversationId: string;
  responseMs: number;
};

type AnswerActor = {
  id: string;
  email?: string | null;
  name?: string | null;
};

/** 웹과 MCP가 같은 지식 검색·답변·로그 규칙을 사용하도록 만든 완결형 서비스입니다. */
export async function answerKnowledgeQuestion(input: {
  question: string;
  actor: AnswerActor;
  interactionSource: "slack_mcp";
  conversationId?: string;
  history?: HistoryTurn[];
}): Promise<KnowledgeAnswerResult> {
  const started = Date.now();
  const conversationId = input.conversationId ?? randomUUID();
  const history = input.history ?? [];
  const common = {
    question: input.question,
    actor: input.actor,
    conversationId,
    interactionSource: input.interactionSource,
    followup: history.length > 0,
  } as const;

  const moderation = await checkQuestion(input.question);
  if (moderation.blocked) {
    const questionId = await insertChatLog({
      ...common,
      answer: BLOCKED_MESSAGE,
      category: "blocked",
      fallback: false,
      responseMs: Date.now() - started,
      citationCount: 0,
      topSimilarity: null,
    });
    return result("blocked", BLOCKED_MESSAGE, [], [], questionId, conversationId, started);
  }

  const rows = await findKnowledge(input.question, history);
  const topSimilarity = rows.length ? rows[0].similarity : null;
  const tooWeak = !rows.some(row => isStrongMatch(row, TOP_MATCH_THRESHOLD));

  if (tooWeak) {
    const questionId = await insertChatLog({
      ...common,
      answer: FALLBACK_ANSWER,
      category: "fallback",
      fallback: true,
      responseMs: Date.now() - started,
      citationCount: 0,
      topSimilarity,
    });
    await recordAction(false, started);
    return result("insufficient", FALLBACK_ANSWER, [], [], questionId, conversationId, started);
  }

  const citations = toCitations(rows);
  const links = collectLinks(rows);
  const aiStarted = Date.now();
  let rawAnswer = "";

  try {
    const stream = await streamAnswer(input.question, citations, rows, history);
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") rawAnswer += event.delta;
      if (event.type === "response.failed" || event.type === "response.incomplete") {
        throw new Error("모델이 답변을 완료하지 못했습니다.");
      }
    }
    await logAiCall({
      provider: "openai",
      model: chatModel(),
      success: true,
      latencyMs: Date.now() - aiStarted,
    }).catch(() => undefined);
  } catch (error) {
    await logAiCall({
      provider: "openai",
      model: chatModel(),
      success: false,
      latencyMs: Date.now() - aiStarted,
      errorCode: errorCodeOf(error),
    }).catch(() => undefined);
    throw error;
  }

  const answer = sanitizeAnswer(rawAnswer).trim();
  if (isEmptyAnswer(answer)) throw new Error("답변을 생성하지 못했습니다. 다시 한번 질문해 주세요.");

  const insufficient = saysInsufficient(answer);
  const finalAnswer = insufficient ? FALLBACK_ANSWER : answer;
  const finalCitations = insufficient ? [] : citations;
  const finalLinks = insufficient ? [] : links;
  const questionId = await insertChatLog({
    ...common,
    answer: finalAnswer,
    category: insufficient ? "fallback" : String(rows[0].metadata.category || "general"),
    fallback: insufficient,
    responseMs: Date.now() - started,
    citationCount: finalCitations.length,
    topSimilarity,
  });

  if (finalCitations.length) {
    await insertCitations(questionId, finalCitations);
    await incrementReuse([...new Set(finalCitations.map(citation => citation.id))]);
  }
  await recordAction(!insufficient, started);

  return result(
    insufficient ? "insufficient" : "answered",
    finalAnswer,
    finalCitations,
    finalLinks,
    questionId,
    conversationId,
    started,
  );
}

async function findKnowledge(question: string, history: HistoryTurn[]) {
  const searchQuery = buildSearchQuery(question, history);
  let rows = await searchDocuments(searchQuery, MATCH_COUNT);
  if (!rows.some(row => isStrongMatch(row, TOP_MATCH_THRESHOLD))) {
    const retried = await searchWithExpansion(searchQuery, MATCH_COUNT);
    if (retried.some(row => isStrongMatch(row, TOP_MATCH_THRESHOLD))) rows = retried;
  }
  return rows;
}

type ChatLogInput = {
  question: string;
  answer: string;
  category: string;
  fallback: boolean;
  actor: AnswerActor;
  conversationId: string;
  interactionSource: "slack_mcp";
  responseMs: number;
  followup: boolean;
  citationCount: number;
  topSimilarity: number | null;
};

async function insertChatLog(input: ChatLogInput) {
  const rows = await database()`
    insert into public.chat_logs
      (user_message, bot_answer, category, is_fallback, user_id, user_email, user_name,
       conversation_id, response_ms, is_followup, citation_count, top_similarity, interaction_source)
    values
      (${input.question}, ${input.answer}, ${input.category}, ${input.fallback}, ${input.actor.id},
       ${input.actor.email ?? null}, ${input.actor.name ?? null}, ${input.conversationId}, ${input.responseMs},
       ${input.followup}, ${input.citationCount}, ${input.topSimilarity}, ${input.interactionSource})
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
      "chat_log_id", "document_id", "position", "title", "source_url", "similarity",
    )}
  `;
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

function collectLinks(rows: SearchRow[]) {
  const seen = new Map<string, { url: string; title: string }>();
  for (const row of rows) {
    const title = documentTitle(row.metadata);
    for (const url of extractUrls(row.content)) {
      if (!seen.has(url)) seen.set(url, { url, title });
    }
    if (seen.size >= 5) break;
  }
  return [...seen.values()].slice(0, 5);
}

function result(
  status: KnowledgeAnswerStatus,
  answer: string,
  citations: Citation[],
  links: { url: string; title: string }[],
  questionId: number,
  conversationId: string,
  started: number,
): KnowledgeAnswerResult {
  return { status, answer, citations, links, questionId, conversationId, responseMs: Date.now() - started };
}

async function recordAction(success: boolean, started: number) {
  await logUserAction({
    action: "mcp_ask_company_knowledge",
    success,
    latencyMs: Date.now() - started,
  }).catch(() => undefined);
}
