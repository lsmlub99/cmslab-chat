import "server-only";

import { hasDatabaseConfig } from "@/lib/database";
import { listTurns } from "@/lib/conversations";
import { hasOpenAIConfig } from "@/lib/openai";
import { CHAT_LIMIT, CHAT_WINDOW_SECONDS, rateLimit } from "@/lib/rate-limit";
import { answerKnowledgeQuestion } from "@/lib/rag/answer-service";
import { HISTORY_TURNS } from "@/lib/rag/answer";
import { errorCodeOf } from "@/lib/rag/ai-error";
import { logUserAction } from "@/lib/server/telemetry.server";
import { finishSlackBotCall } from "@/lib/slack/call-log";
import type { SlackInboundMessage } from "@/lib/slack/events";
import { formatSlackAnswer } from "@/lib/slack/format";

const MAX_QUESTION_CHARS = 2_000;

export async function handleSlackMessage(message: SlackInboundMessage, callId: number) {
  const started = Date.now();
  let progressMessageTs: string | null = null;
  let finalReplySent = false;
  let answerCompleted = false;
  try {
    if (!hasDatabaseConfig() || !hasOpenAIConfig() || !hasSlackBotToken()) {
      throw codedError("slack_bot_not_configured");
    }

    if (!message.question) {
      const example = message.interactionKind === "direct_message"
        ? "질문을 입력해 주세요. 예: `복리후생 제도 알려줘`"
        : "질문을 함께 적어주세요. 예: `@raebi 복리후생 제도 알려줘`";
      await postSlackReply(message, example);
      finalReplySent = true;
      await finishSlackBotCall({ id: callId, status: "insufficient", latencyMs: Date.now() - started });
      await recordFailedAction(message.interactionKind, started);
      return;
    }
    if (message.question.length > MAX_QUESTION_CHARS) {
      await postSlackReply(message, `질문은 ${MAX_QUESTION_CHARS.toLocaleString("ko-KR")}자 이내로 입력해 주세요.`);
      finalReplySent = true;
      await finishSlackBotCall({ id: callId, status: "insufficient", latencyMs: Date.now() - started });
      await recordFailedAction(message.interactionKind, started);
      return;
    }

    const workspace = message.enterpriseId ?? message.teamId ?? "workspace";
    const limit = await rateLimit(
      `slack:${workspace}:${message.userId}`,
      CHAT_LIMIT(),
      CHAT_WINDOW_SECONDS(),
    );
    if (!limit.allowed) {
      await postSlackReply(message, `질문이 너무 빠릅니다. ${limit.retryAfter}초 후 다시 시도해 주세요.`);
      finalReplySent = true;
      await finishSlackBotCall({ id: callId, status: "rate_limited", latencyMs: Date.now() - started });
      await recordFailedAction(message.interactionKind, started);
      return;
    }

    // 모델 응답을 기다리는 동안에도 Slack에 즉시 상태를 보여 줍니다. 같은 메시지를
    // 최종 답변으로 갱신하므로 스레드에 진행 메시지가 따로 남지 않습니다.
    progressMessageTs = await postSlackReply(message, "⏳ 사내 문서에서 근거를 찾고 있어요…");

    const actorId = `slack:${workspace}:${message.userId}`;
    const conversationId = message.interactionKind === "direct_message"
      ? `slack:${workspace}:${message.channelId}:dm`
      : `slack:${workspace}:${message.channelId}:${message.threadTs ?? message.eventTs}`;
    const history = (await listTurns(conversationId, actorId))
      .filter(turn => !turn.isFallback)
      .slice(-HISTORY_TURNS)
      .map(turn => ({ question: turn.question, answer: turn.answer }));

    const answer = await answerKnowledgeQuestion({
      question: message.question,
      actor: { id: actorId },
      interactionSource: message.interactionKind === "direct_message" ? "slack_dm" : "slack_mention",
      conversationId,
      history,
    });
    answerCompleted = true;
    await replaceProgressOrPost(message, progressMessageTs, formatSlackAnswer(answer));
    finalReplySent = true;
    await finishSlackBotCall({
      id: callId,
      status: answer.status === "answered" ? "succeeded" : answer.status,
      latencyMs: Date.now() - started,
      chatLogId: answer.questionId,
    });
  } catch (error) {
    if (!finalReplySent) {
      const failureMessage = "사내 지식을 조회하지 못했습니다. 잠시 후 다시 질문해 주세요.";
      if (progressMessageTs) {
        await replaceProgressOrPost(message, progressMessageTs, failureMessage).catch(() => undefined);
      } else {
        await postSlackReply(message, failureMessage).catch(() => undefined);
      }
    }
    await finishSlackBotCall({
      id: callId,
      status: "failed",
      latencyMs: Date.now() - started,
      errorCode: errorCodeOf(error),
    }).catch(() => undefined);
    if (!answerCompleted) await recordFailedAction(message.interactionKind, started);
  }
}

async function postSlackReply(message: SlackInboundMessage, text: string) {
  const payload = await callSlackApi<{ ts?: string }>("chat.postMessage", {
    channel: message.channelId,
    ...(message.interactionKind === "mention" ? { thread_ts: message.threadTs ?? message.eventTs } : {}),
    text,
    unfurl_links: false,
    unfurl_media: false,
  });
  if (!payload.ts) throw codedError("slack_api_missing_message_ts");
  return payload.ts;
}

async function updateSlackReply(channel: string, ts: string, text: string) {
  await callSlackApi("chat.update", {
    channel,
    ts,
    text,
    as_user: true,
  });
}

async function replaceProgressOrPost(message: SlackInboundMessage, progressTs: string, text: string) {
  try {
    await updateSlackReply(message.channelId, progressTs, text);
  } catch {
    // 드물게 기존 메시지 수정이 거절돼도 사용자가 최종 답변을 잃지는 않게 합니다.
    await postSlackReply(message, text);
  }
}

async function callSlackApi<T extends Record<string, unknown> = Record<string, unknown>>(
  method: string,
  body: Record<string, unknown>,
) {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  if (!token) throw new Error("SLACK_BOT_TOKEN_MISSING");

  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as ({ ok?: boolean; error?: string } & T) | null;
  if (!response.ok || !payload?.ok) {
    const code = payload?.error?.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || `http_${response.status}`;
    throw codedError(`slack_api_${code}`.slice(0, 40));
  }
  return payload;
}

function hasSlackBotToken() {
  return Boolean(process.env.SLACK_BOT_TOKEN?.trim());
}

function codedError(code: string) {
  return Object.assign(new Error(code), { code });
}

async function recordFailedAction(interactionKind: SlackInboundMessage["interactionKind"], started: number) {
  await logUserAction({
    action: interactionKind === "direct_message"
      ? "slack_dm_ask_company_knowledge"
      : "slack_mention_ask_company_knowledge",
    success: false,
    latencyMs: Date.now() - started,
  }).catch(() => undefined);
}
