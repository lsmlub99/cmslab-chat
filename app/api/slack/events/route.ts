import { after } from "next/server";
import { hasDatabaseConfig } from "@/lib/database";
import { hasOpenAIConfig } from "@/lib/openai";
import { verifySlackRequest } from "@/lib/mcp/slack-auth";
import { handleSlackMessage } from "@/lib/slack/bot";
import { beginSlackBotCall } from "@/lib/slack/call-log";
import { parseSlackEnvelope } from "@/lib/slack/events";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  const verified = verifySlackRequest(request.headers, rawBody);
  if (!verified.ok) {
    const status = verified.reason === "not_configured" ? 503 : 401;
    return Response.json(
      { error: status === 503 ? "Slack 인증 설정이 필요합니다." : "유효하지 않은 Slack 요청입니다." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ error: "JSON 요청이 필요합니다." }, { status: 400 });
  }

  const envelope = parseSlackEnvelope(body);
  if (envelope.kind === "challenge") {
    return Response.json({ challenge: envelope.challenge }, { headers: { "Cache-Control": "no-store" } });
  }
  if (envelope.kind === "invalid") {
    return Response.json({ error: "올바르지 않은 Slack 이벤트입니다." }, { status: 400 });
  }
  if (envelope.kind === "ignored") return Response.json({ ok: true });

  if (!hasDatabaseConfig() || !hasOpenAIConfig()) {
    return Response.json({ error: "답봇 서버 설정이 완료되지 않았습니다." }, { status: 503 });
  }

  try {
    const call = await beginSlackBotCall(envelope.message);
    if (!call.duplicate && call.id !== null) {
      after(async () => {
        await handleSlackMessage(envelope.message, call.id);
      });
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Slack 이벤트를 접수하지 못했습니다." }, { status: 503 });
  }
}

export function GET() {
  return Response.json({ error: "Method not allowed." }, {
    status: 405,
    headers: { Allow: "POST", "Cache-Control": "no-store" },
  });
}
