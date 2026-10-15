-- 일반 Slack 앱의 @answerbot 호출을 중복 없이 집계합니다.

create table if not exists public.slack_bot_calls(
  id bigserial primary key,
  event_id text not null unique,
  slack_team_id text,
  slack_enterprise_id text,
  slack_user_id text not null,
  slack_channel_id text not null,
  status text not null default 'processing'
    check (status in ('processing', 'succeeded', 'insufficient', 'blocked', 'rate_limited', 'failed')),
  latency_ms integer,
  chat_log_id bigint references public.chat_logs(id) on delete set null,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists slack_bot_calls_created_at_idx
  on public.slack_bot_calls(created_at desc);
create index if not exists slack_bot_calls_workspace_user_idx
  on public.slack_bot_calls(slack_enterprise_id, slack_team_id, slack_user_id, created_at desc);
create index if not exists slack_bot_calls_status_idx
  on public.slack_bot_calls(status, created_at desc);
