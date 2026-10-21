-- 기존 지식 청크 재구성 전 원본을 보존합니다.
create table if not exists public.document_reindex_backups (
  id bigserial primary key,
  backup_batch uuid not null,
  original_document_id bigint not null,
  content text not null,
  metadata jsonb,
  embedding vector(1536),
  reuse_count integer not null default 0,
  original_created_at timestamptz,
  original_updated_at timestamptz,
  backed_up_at timestamptz not null default now()
);

create index if not exists document_reindex_backups_batch_idx
  on public.document_reindex_backups(backup_batch);
create index if not exists document_reindex_backups_original_idx
  on public.document_reindex_backups(original_document_id);

