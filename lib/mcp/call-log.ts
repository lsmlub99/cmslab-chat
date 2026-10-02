import "server-only";

import { database } from "@/lib/database";

export type McpCallStatus =
  | "processing"
  | "succeeded"
  | "insufficient"
  | "blocked"
  | "rate_limited"
  | "failed";

export type SlackIdentity = {
  userId: string;
  teamId: string | null;
  enterpriseId: string | null;
};

type StoredResult = Record<string, unknown>;

export async function beginMcpCall(input: {
  fingerprint: string;
  requestId: string;
  toolName: string;
  identity: SlackIdentity;
}) {
  const sql = database();
  const inserted = await sql`
    insert into public.mcp_tool_calls
      (request_fingerprint, jsonrpc_id, tool_name, slack_user_id, slack_team_id, slack_enterprise_id, status)
    values
      (${input.fingerprint}, ${input.requestId}, ${input.toolName}, ${input.identity.userId},
       ${input.identity.teamId}, ${input.identity.enterpriseId}, 'processing')
    on conflict (request_fingerprint) do nothing
    returning id
  `;

  if (inserted.length) {
    return { id: Number(inserted[0].id), duplicate: false as const, status: "processing" as const, result: null };
  }

  const existing = await sql`
    select id, status, result_json
    from public.mcp_tool_calls
    where request_fingerprint = ${input.fingerprint}
    limit 1
  `;
  const row = existing[0];
  return {
    id: Number(row.id),
    duplicate: true as const,
    status: String(row.status) as McpCallStatus,
    result: asStoredResult(row.result_json),
  };
}

export async function finishMcpCall(input: {
  id: number;
  status: Exclude<McpCallStatus, "processing">;
  latencyMs: number;
  chatLogId?: number | null;
  result?: StoredResult | null;
  errorCode?: string | null;
}) {
  await database()`
    update public.mcp_tool_calls
       set status = ${input.status},
           latency_ms = ${Math.max(0, Math.round(input.latencyMs))},
           chat_log_id = ${input.chatLogId ?? null},
           result_json = ${input.result ? JSON.stringify(input.result) : null}::jsonb,
           error_code = ${input.errorCode ?? null},
           completed_at = now()
     where id = ${input.id}
  `;
}

function asStoredResult(value: unknown): StoredResult | null {
  if (!value) return null;
  if (typeof value === "string") {
    try { return asStoredResult(JSON.parse(value)); } catch { return null; }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? value as StoredResult
    : null;
}
