-- Slackbot MCP 호출을 웹 질문과 구분하고, 재시도에도 한 번만 집계합니다.

alter table public.chat_logs
  add column if not exists interaction_source text not null default 'web';

create index if not exists chat_logs_interaction_source_created_at_idx
  on public.chat_logs(interaction_source, created_at desc);

create table if not exists public.mcp_tool_calls(
  id bigserial primary key,
  request_fingerprint text not null unique,
  jsonrpc_id text not null,
  tool_name text not null,
  slack_user_id text not null,
  slack_team_id text,
  slack_enterprise_id text,
  status text not null default 'processing'
    check (status in ('processing', 'succeeded', 'insufficient', 'blocked', 'rate_limited', 'failed')),
  latency_ms integer,
  chat_log_id bigint references public.chat_logs(id) on delete set null,
  result_json jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists mcp_tool_calls_created_at_idx
  on public.mcp_tool_calls(created_at desc);
create index if not exists mcp_tool_calls_workspace_user_idx
  on public.mcp_tool_calls(slack_enterprise_id, slack_team_id, slack_user_id, created_at desc);
create index if not exists mcp_tool_calls_status_idx
  on public.mcp_tool_calls(status, created_at desc);
