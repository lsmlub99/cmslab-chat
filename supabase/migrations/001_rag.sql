-- 답봇(answerbot) 기본 스키마
--
-- 이 프로젝트는 교육 과정에서 만들어진 기존 public.documents / chat_logs / feedback 를
-- 그대로 사용합니다. 새 테이블로 갈아엎지 않고, 운영·분석에 필요한 컬럼만 보강합니다.
-- 모든 문장이 멱등(idempotent)이라 여러 번 실행해도 안전합니다.

create extension if not exists vector;
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ── 지식 청크 (public.documents) ──────────────────────────────────────────────
-- content       : 청크 본문
-- embedding     : vector(1536) — text-embedding-3-small
-- content_fts   : to_tsvector('simple', content) 저장형 생성 컬럼 (자동 갱신)
-- metadata      : title / category / file_type / source_hash / source_url / page ...
create table if not exists public.documents(
  id bigserial primary key,
  content text,
  embedding vector(1536),
  metadata jsonb
);

alter table public.documents add column if not exists reuse_count integer not null default 0;
alter table public.documents add column if not exists created_at timestamptz not null default now();
alter table public.documents add column if not exists updated_at timestamptz not null default now();
alter table public.documents alter column embedding drop not null;

do $$
begin
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.documents'::regclass and attname = 'content_fts' and not attisdropped
  ) then
    alter table public.documents
      add column content_fts tsvector generated always as (to_tsvector('simple', content)) stored;
  end if;
end $$;

-- 벡터 검색용 HNSW 인덱스 (코사인 거리)
create index if not exists documents_embedding_idx
  on public.documents using hnsw (embedding vector_cosine_ops);
-- 한국어는 조사 때문에 tsvector 매칭이 잘 안 되므로 ilike 부분일치를 트라이그램으로 가속합니다.
create index if not exists documents_content_trgm_idx
  on public.documents using gin (content gin_trgm_ops);
create index if not exists documents_fts_idx
  on public.documents using gin (content_fts);
create index if not exists documents_source_hash_idx
  on public.documents ((metadata->>'source_hash'));
create index if not exists documents_title_idx
  on public.documents ((metadata->>'title'));

-- ── 질문·답변 로그 (public.chat_logs) ────────────────────────────────────────
create table if not exists public.chat_logs(
  id bigserial primary key,
  user_message text not null,
  bot_answer text not null,
  category text,
  is_fallback boolean default false,
  created_at timestamptz default now()
);

alter table public.chat_logs add column if not exists user_id text;
alter table public.chat_logs add column if not exists conversation_id text;
alter table public.chat_logs add column if not exists response_ms integer;
alter table public.chat_logs add column if not exists is_followup boolean not null default false;
alter table public.chat_logs add column if not exists citation_count integer not null default 0;
alter table public.chat_logs add column if not exists top_similarity numeric;

create index if not exists chat_logs_created_at_idx on public.chat_logs(created_at desc);
create index if not exists chat_logs_user_id_idx on public.chat_logs(user_id);
create index if not exists chat_logs_fallback_idx on public.chat_logs(is_fallback, created_at desc);

-- ── 만족도 피드백 (public.feedback) ──────────────────────────────────────────
create table if not exists public.feedback(
  id bigserial primary key,
  user_message text not null,
  bot_answer text not null,
  rating smallint not null,
  created_at timestamptz default now()
);

alter table public.feedback add column if not exists chat_log_id bigint;
alter table public.feedback add column if not exists note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_chat_log_id_fkey') then
    alter table public.feedback
      add constraint feedback_chat_log_id_fkey
      foreign key (chat_log_id) references public.chat_logs(id) on delete cascade;
  end if;
end $$;

create index if not exists feedback_chat_log_idx on public.feedback(chat_log_id);
create index if not exists feedback_created_at_idx on public.feedback(created_at desc);

-- 같은 답변에 두 번 투표하는 것을 막습니다.
-- 부분 인덱스(where chat_log_id is not null)로 만들면 ON CONFLICT 가 이 인덱스를 추론하지
-- 못해 "no unique or exclusion constraint matching" 오류가 납니다. 일반 인덱스로 둡니다.
-- NULL 은 서로 다른 값으로 취급되므로 chat_log_id 가 없는 과거 행은 그대로 공존합니다.
drop index if exists public.feedback_chat_log_unique;
create unique index if not exists feedback_chat_log_unique
  on public.feedback(chat_log_id);

-- ── 답변별 출처 기록 ────────────────────────────────────────────────────────
create table if not exists public.chat_log_citations(
  id bigserial primary key,
  chat_log_id bigint not null references public.chat_logs(id) on delete cascade,
  document_id bigint not null references public.documents(id) on delete cascade,
  position integer not null,
  title text,
  source_url text,
  similarity numeric,
  created_at timestamptz not null default now()
);
create index if not exists chat_log_citations_log_idx on public.chat_log_citations(chat_log_id);
create index if not exists chat_log_citations_document_idx on public.chat_log_citations(document_id);

-- ── 속도 제한 ───────────────────────────────────────────────────────────────
-- 서버리스(Vercel)에서는 인스턴스마다 메모리가 따로라 메모리 카운터가 무력화됩니다.
-- 모든 인스턴스가 같은 값을 보도록 DB에 셉니다. 고정 창(fixed window) 방식입니다.
create table if not exists public.rate_limits(
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);
create index if not exists rate_limits_window_idx on public.rate_limits(window_start);

-- ── 챗봇 화면 설정 ──────────────────────────────────────────────────────────
create table if not exists public.workspace_settings(
  id boolean primary key default true check (id = true),
  bot_name text not null default '답봇',
  team_name text not null default '교육 대표팀',
  welcome_message text not null default '안녕하세요. 팀 지식에서 근거를 찾아 답해드릴게요.',
  accent_color text not null default '#273e82',
  updated_at timestamptz not null default now()
);
insert into public.workspace_settings(id) values (true) on conflict (id) do nothing;
