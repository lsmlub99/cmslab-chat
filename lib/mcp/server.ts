import "server-only";

import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { hasDatabaseConfig } from "@/lib/database";
import { hasOpenAIConfig } from "@/lib/openai";
import { CHAT_LIMIT, CHAT_WINDOW_SECONDS, rateLimit } from "@/lib/rate-limit";
import { answerKnowledgeQuestion, type KnowledgeAnswerResult } from "@/lib/rag/answer-service";
import { beginMcpCall, finishMcpCall, type SlackIdentity } from "@/lib/mcp/call-log";
import { errorCodeOf } from "@/lib/rag/ai-error";

const TOOL_NAME = "ask_company_knowledge";
const STATUSES = ["answered", "insufficient", "blocked"] as const;

const citationSchema = z.object({
  title: z.string(),
  sourceUrl: z.string().optional(),
  page: z.number().optional(),
});

const outputSchema = {
  status: z.enum(STATUSES),
  answer: z.string(),
  questionId: z.number(),
  citations: z.array(citationSchema),
};

type ToolPayload = {
  status: typeof STATUSES[number];
  answer: string;
  questionId: number;
  citations: { title: string; sourceUrl?: string; page?: number }[];
};

export function createAnswerbotMcpServer(requestFingerprint: string) {
  const server = new McpServer({ name: "answerbot-rag", version: "1.0.0" });

  server.registerTool(TOOL_NAME, {
    title: "사내 지식 답변",
    description:
      "등록된 사내 규정, 업무 매뉴얼, 복리후생, 조직 제도와 팀 지식 문서에서 근거를 찾아 답변합니다. " +
      "사내 정보나 회사 업무 절차에 관한 질문에는 이 읽기 전용 도구를 사용하세요.",
    inputSchema: {
      question: z.string().trim().min(1).max(2000).describe("사용자가 묻는 사내 지식 질문"),
    },
    outputSchema,
    annotations: {
      title: "사내 지식 검색",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, async ({ question }, extra) => {
    const started = Date.now();
    const identity = slackIdentity(extra._meta);
    if (!identity) return toolError("Slack 사용자 정보를 확인할 수 없습니다.");
    if (!hasOpenAIConfig() || !hasDatabaseConfig()) {
      return toolError("답봇 서버 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.");
    }

    const fingerprint = createHash("sha256")
      .update(`${requestFingerprint}:${String(extra.requestId)}:${TOOL_NAME}`)
      .digest("hex");
    let callId: number | undefined;
    try {
      const call = await beginMcpCall({
        fingerprint,
        requestId: String(extra.requestId),
        toolName: TOOL_NAME,
        identity,
      });
      callId = call.id;

      if (call.duplicate) {
        const cached = parsePayload(call.result);
        if (cached) return toolResult(cached);
        return toolError("같은 요청을 이미 처리했거나 처리 중입니다. 잠시 후 다시 시도해 주세요.");
      }

      const limit = await rateLimit(
        `mcp:${identity.enterpriseId ?? identity.teamId ?? "workspace"}:${identity.userId}`,
        CHAT_LIMIT(),
        CHAT_WINDOW_SECONDS(),
      );
      if (!limit.allowed) {
        await finishMcpCall({ id: call.id, status: "rate_limited", latencyMs: Date.now() - started });
        return toolError(`질문이 너무 빠릅니다. ${limit.retryAfter}초 후 다시 시도해 주세요.`);
      }

      const answer = await answerKnowledgeQuestion({
        question,
        actor: {
          id: `slack:${identity.enterpriseId ?? identity.teamId ?? "workspace"}:${identity.userId}`,
        },
        interactionSource: "slack_mcp",
      });
      const payload = toPayload(answer);
      await finishMcpCall({
        id: call.id,
        status: answer.status === "answered" ? "succeeded" : answer.status,
        latencyMs: Date.now() - started,
        chatLogId: answer.questionId,
        result: payload,
      });
      return toolResult(payload);
    } catch (error) {
      if (callId !== undefined) {
        await finishMcpCall({
          id: callId,
          status: "failed",
          latencyMs: Date.now() - started,
          errorCode: errorCodeOf(error),
        }).catch(() => undefined);
      }
      return toolError("사내 지식을 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
  });

  return server;
}

export function slackIdentity(meta: unknown): SlackIdentity | null {
  if (!isRecord(meta) || !isRecord(meta.slack)) return null;
  const userId = stringOrNull(meta.slack.user_id);
  const teamId = stringOrNull(meta.slack.team_id);
  const enterpriseId = stringOrNull(meta.slack.enterprise_id);
  if (!userId || (!teamId && !enterpriseId)) return null;
  return { userId, teamId, enterpriseId };
}

function toPayload(answer: KnowledgeAnswerResult): ToolPayload {
  return {
    status: answer.status,
    answer: answer.answer,
    questionId: answer.questionId,
    citations: answer.citations.map(citation => ({
      title: citation.title,
      ...(citation.sourceUrl ? { sourceUrl: citation.sourceUrl } : {}),
      ...(citation.page ? { page: citation.page } : {}),
    })),
  };
}

function toolResult(payload: ToolPayload) {
  const sources = payload.citations.length
    ? `\n\n근거\n${payload.citations.map((citation, index) =>
        `${index + 1}. ${citation.title}${citation.page ? ` (${citation.page}쪽)` : ""}${citation.sourceUrl ? ` - ${citation.sourceUrl}` : ""}`,
      ).join("\n")}`
    : "";
  return {
    content: [{ type: "text" as const, text: `${payload.answer}${sources}` }],
    structuredContent: payload,
  };
}

function toolError(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

function parsePayload(value: Record<string, unknown> | null): ToolPayload | null {
  const parsed = z.object(outputSchema).safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
