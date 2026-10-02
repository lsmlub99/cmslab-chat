import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAnswerbotMcpServer } from "@/lib/mcp/server";
import { verifySlackRequest } from "@/lib/mcp/slack-auth";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  const rawBody = await request.clone().text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return Response.json({ error: "요청 본문이 너무 큽니다." }, { status: 413 });
  }

  const verified = verifySlackRequest(request.headers, rawBody);
  if (!verified.ok) {
    const status = verified.reason === "not_configured" ? 503 : 401;
    return Response.json(
      { error: status === 503 ? "Slack MCP 인증 설정이 필요합니다." : "유효하지 않은 Slack 요청입니다." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestFingerprint = createHash("sha256")
    .update(`${verified.timestamp}:${verified.signature}:${rawBody}`)
    .digest("hex");
  const server = createAnswerbotMcpServer(requestFingerprint);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY_BYTES,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody: JSON.parse(rawBody) });
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return Response.json({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal server error" },
      id: null,
    }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export function GET() { return methodNotAllowed(); }
export function DELETE() { return methodNotAllowed(); }

function methodNotAllowed() {
  return Response.json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  }, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}
