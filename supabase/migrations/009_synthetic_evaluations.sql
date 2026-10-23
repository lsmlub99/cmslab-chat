-- 내부 데모용 예상 질의 품질검증 결과입니다.
-- 실제 직원 대화(chat_logs)와 물리적으로 분리하며 모든 행은 synthetic=true 입니다.
create table if not exists public.synthetic_evaluations (
  id bigserial primary key,
  scenario_key text not null unique,
  question text not null,
  topic text not null,
  expected_source text,
  status text not null check (status in ('passed', 'failed', 'needs_knowledge')),
  matched_source text,
  evidence_preview text,
  similarity double precision,
  keyword_hits integer not null default 0,
  retrieval_ms integer,
  evaluated_at timestamptz not null default now(),
  synthetic boolean not null default true check (synthetic = true)
);

create index if not exists synthetic_evaluations_status_idx
  on public.synthetic_evaluations(status);
create index if not exists synthetic_evaluations_topic_idx
  on public.synthetic_evaluations(topic);

comment on table public.synthetic_evaluations is
  '내부 시뮬레이션용 예상 질의 검색 평가. 실사용 KPI 및 chat_logs 집계에서 제외.';
