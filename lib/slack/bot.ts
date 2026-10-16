import "server-only";

import { hasDatabaseConfig } from "@/lib/database";
import { hasOpenAIConfig } from "@/lib/openai";
import { CHAT_LIMIT, CHAT_WINDOW_SECONDS, rateLimit } from "@/lib/rate-limit";
import { answerKnowledgeQuestion } from "@/lib/rag/answer-service";
import { errorCodeOf } from "@/lib/rag/ai-error";
import { logUserAction } from "@/lib/server/telemetry.server";
import { finishSlackBotCall } from "@/lib/slack/call-log";
import type { SlackMention } from "@/lib/slack/events";
import { formatSlackAnswer } from "@/lib/slack/format";

const MAX_QUESTION_CHARS = 2_000;

export async function handleSlackMention(mention: SlackMention, callId: number) {
  const started = Date.now();
  let progressMessageTs: string | null = null;
  let finalReplySent = false;
  let answerCompleted = false;
  try {
    if (!hasDatabaseConfig() || !hasOpenAIConfig() || !hasSlackBotToken()) {
      throw codedError("slack_bot_not_configured");
    }

    if (!mention.question) {
      await postSlackReply(mention, "질문을 함께 적어주세요. 예: `@answerbot 복리후생 제도 알려줘`");
      finalReplySent = true;
      await finishSlackBotCall({ id: callId, status: "insufficient", latencyMs: Date.now() - started });
      await recordFailedAction(started);
      return;
    }
    if (mention.question.length > MAX_QUESTION_CHARS) {
      await postSlackReply(mention, `질문은 ${MAX_QUESTION_CHARS.toLocaleString("ko-KR")}자 이내로 입력해 주세요.`);
      finalReplySent = true;
      await finishSlackBotCall({ id: callId, status: "insufficient", latencyMs: Date.now() - started });
      await recordFailedAction(started);
      return;
    }

    const workspace = mention.enterpriseId ?? mention.teamId ?? "workspace";
    const limit = await rateLimit(
      `slack-mention:${workspace}:${mention.userId}`,
      CHAT_LIMIT(),
      CHAT_WINDOW_SECONDS(),
    );
    if (!limit.allowed) {
      await postSlackReply(mention, `질문이 너무 빠릅니다. ${limit.retryAfter}초 후 다시 시도해 주세요.`);
      finalReplySent = true;
      await finishSlackBotCall({ id: callId, status: "rate_limited", latencyMs: Date.now() - started });
      await recordFailedAction(started);
      return;
    }

    // 모델 응답을 기다리는 동안에도 Slack에 즉시 상태를 보여 줍니다. 같은 메시지를
    // 최종 답변으로 갱신하므로 스레드에 진행 메시지가 따로 남지 않습니다.
    progressMessageTs = await postSlackReply(mention, "⏳ 사내 문서에서 근거를 찾고 있어요…");

    const answer = await answerKnowledgeQuestion({
      question: mention.question,
      actor: { id: `slack:${workspace}:${mention.userId}` },
      interactionSource: "slack_mention",
      conversationId: `slack:${workspace}:${mention.channelId}:${mention.threadTs ?? mention.eventTs}`,
    });
    answerCompleted = true;
    await replaceProgressOrPost(mention, progressMessageTs, formatSlackAnswer(answer));
    finalReplySent = true;
    await finishSlackBotCall({
      id: callId,
      status: answer.status === "answered" ? "succeeded" : answer.status,
      latencyMs: Date.now() - started,
      chatLogId: answer.questionId,
    });
  } catch (error) {
    if (!finalReplySent) {
      const message = "사내 지식을 조회하지 못했습니다. 잠시 후 다시 질문해 주세요.";
      if (progressMessageTs) {
        await replaceProgressOrPost(mention, progressMessageTs, message).catch(() => undefined);
      } else {
        await postSlackReply(mention, message).catch(() => undefined);
      }
    }
    await finishSlackBotCall({
      id: callId,
      status: "failed",
      latencyMs: Date.now() - started,
      errorCode: errorCodeOf(error),
    }).catch(() => undefined);
    if (!answerCompleted) await recordFailedAction(started);
  }
}

async function postSlackReply(mention: SlackMention, text: string) {
  const payload = await callSlackApi<{ ts?: string }>("chat.postMessage", {
    channel: mention.channelId,
    thread_ts: mention.threadTs ?? mention.eventTs,
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

async function replaceProgressOrPost(mention: SlackMention, progressTs: string, text: string) {
  try {
    await updateSlackReply(mention.channelId, progressTs, text);
  } catch {
    // 드물게 기존 메시지 수정이 거절돼도 사용자가 최종 답변을 잃지는 않게 합니다.
    await postSlackReply(mention, text);
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

async function recordFailedAction(started: number) {
  await logUserAction({
    action: "slack_mention_ask_company_knowledge",
    success: false,
    latencyMs: Date.now() - started,
  }).catch(() => undefined);
}
