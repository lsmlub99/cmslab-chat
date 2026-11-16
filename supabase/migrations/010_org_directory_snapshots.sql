-- Google Workspace 조직도에서 월 1회 동기화한 현원 집계입니다.
-- 이름과 이메일은 저장하지 않고 활성 인원 수만 보관합니다.
create table if not exists public.org_directory_snapshots (
  id bigserial primary key,
  snapshot_month date not null unique,
  snapshot_at timestamptz not null,
  total_active integer not null check (total_active >= 0),
  org_unit_count integer not null check (org_unit_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_directory_counts (
  snapshot_id bigint not null references public.org_directory_snapshots(id) on delete cascade,
  org_unit_path text not null check (char_length(org_unit_path) between 1 and 500),
  active_count integer not null check (active_count >= 0),
  primary key (snapshot_id, org_unit_path)
);

create index if not exists org_directory_snapshots_latest_idx
  on public.org_directory_snapshots(snapshot_at desc);

comment on table public.org_directory_snapshots is
  'Google Workspace 월별 현원 스냅샷. 개인정보 없이 집계 수치만 저장.';
