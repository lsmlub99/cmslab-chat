-- Slack 앱의 메시지 탭(DM)과 채널 @mention 호출을 구분해 집계합니다.

alter table public.slack_bot_calls
  add column if not exists interaction_kind text not null default 'mention';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'slack_bot_calls_interaction_kind_check'
  ) then
    alter table public.slack_bot_calls
      add constraint slack_bot_calls_interaction_kind_check
      check (interaction_kind in ('mention', 'direct_message'));
  end if;
end $$;

create index if not exists slack_bot_calls_interaction_kind_created_at_idx
  on public.slack_bot_calls(interaction_kind, created_at desc);
