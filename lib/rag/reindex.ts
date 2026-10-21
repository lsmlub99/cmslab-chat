import "server-only";

import { randomUUID } from "node:crypto";
import { database } from "@/lib/database";
import { chunkText } from "@/lib/rag/chunk";
import { embedTexts } from "@/lib/rag/embeddings";
import { generateSearchAliases } from "@/lib/rag/aliases";
import { extractUrls } from "@/lib/rag/links";
import { reconstructDocument } from "@/lib/rag/reconstruct";
import { redactSensitiveText } from "@/lib/rag/redact";

type StoredRow = {
  id: string | number;
  content: string;
  metadata: unknown;
  reuse_count: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type PreparedDocument = {
  sourceHash: string;
  title: string;
  oldIds: number[];
  oldChunks: number;
  newChunks: {
    content: string;
    metadata: Record<string, unknown>;
    embedding: number[];
    reuseCount: number;
    createdAt: Date;
  }[];
};

export type ReindexResult = {
  backupBatch: string;
  documents: { title: string; oldChunks: number; newChunks: number }[];
  skipped: { title: string; reason: string }[];
};

export async function reindexExistingDocuments(options: { force?: boolean } = {}): Promise<ReindexResult> {
  const sql = database();
  const backupTable = await sql`select to_regclass('public.document_reindex_backups') as name`;
  if (!backupTable[0]?.name) throw new Error("007_document_reviews_and_reindex.sql을 먼저 적용해 주세요.");

  const stored = await sql`
    select id, content, metadata, reuse_count, created_at, updated_at
    from public.documents
    order by coalesce(nullif(metadata->>'source_hash', ''), 'doc:' || id::text),
             coalesce((metadata->>'chunk_index')::int, id)
  ` as unknown as StoredRow[];

  const groups = groupRows(stored);
  const prepared: PreparedDocument[] = [];
  const skipped: ReindexResult["skipped"] = [];

  // 공급자 호출을 순차 실행해 일시적인 rate limit과 메모리 급증을 피합니다.
  for (const rows of groups.values()) {
    const firstMetadata = asMetadata(rows[0].metadata);
    const title = String(firstMetadata.title || firstMetadata.fileName || "제목 없는 지식");
    if (!options.force && rows.every(row => Number(asMetadata(row.metadata).reindex_version ?? 0) >= 3)) {
      skipped.push({ title, reason: "already_reindexed" });
      continue;
    }

    const reconstructed = redactSensitiveText(reconstructDocument(rows.map(row => row.content)));
    const chunks = chunkText(reconstructed);
    if (!chunks.length) {
      skipped.push({ title, reason: "empty_document" });
      continue;
    }

    const category = String(firstMetadata.category || "일반");
    const aliases = await generateSearchAliases({ title, category, chunks });
    const embeddings = await embedTexts(chunks.map((chunk, index) => [
      `문서: ${title}`,
      `분류: ${category}`,
      chunk.section ? `섹션: ${chunk.section}` : "",
      aliases[index]?.length ? `검색 표현: ${aliases[index].join(" / ")}` : "",
      chunk.content,
    ].filter(Boolean).join("\n")));
    if (embeddings.length !== chunks.length) throw new Error(`${title} 문서의 임베딩 수가 청크 수와 다릅니다.`);

    const sourceHash = groupKey(rows[0]);
    const totalReuse = rows.reduce((sum, row) => sum + Number(row.reuse_count || 0), 0);
    const createdAt = rows.reduce((oldest, row) => {
      const value = new Date(row.created_at);
      return value < oldest ? value : oldest;
    }, new Date(rows[0].created_at));
    const sourceUrl = firstString(rows, "source_url") || extractUrls(reconstructed)[0] || null;

    prepared.push({
      sourceHash,
      title,
      oldIds: rows.map(row => Number(row.id)),
      oldChunks: rows.length,
      newChunks: chunks.map((chunk, index) => ({
        content: chunk.content,
        embedding: embeddings[index],
        reuseCount: index === 0 ? totalReuse : 0,
        createdAt,
        metadata: {
          title,
          category,
          file_type: String(firstMetadata.file_type || "text"),
          source_hash: sourceHash,
          source_label: firstString(rows, "source_label") || null,
          source_url: sourceUrl,
          chunk_index: index,
          token_count: chunk.tokenCount,
          page: null,
          section: chunk.section ?? null,
          search_aliases: aliases[index] ?? [],
          owner: firstString(rows, "owner") || null,
          effective_date: firstString(rows, "effective_date") || null,
          expires_at: firstString(rows, "expires_at") || null,
          authority: firstString(rows, "authority") || "reference",
          priority: safePriority(firstString(rows, "priority")),
          reviewed_at: firstString(rows, "reviewed_at") || null,
          reviewed_by: firstString(rows, "reviewed_by") || null,
          reindex_version: 3,
          reindexed_at: new Date().toISOString(),
          status: "ready",
        },
      })),
    });
  }

  const backupBatch = randomUUID();
  const completed: ReindexResult["documents"] = [];
  for (const document of prepared) {
    await sql.begin(async transaction => {
      await transaction`
        insert into public.document_reindex_backups
          (backup_batch, original_document_id, content, metadata, embedding, reuse_count,
           original_created_at, original_updated_at)
        select ${backupBatch}::uuid, id, content, metadata, embedding, reuse_count, created_at, updated_at
        from public.documents
        where id = any(${document.oldIds}::bigint[])
      `;

      const contents = document.newChunks.map(chunk => chunk.content);
      const metadatas = document.newChunks.map(chunk => JSON.stringify(chunk.metadata));
      const embeddings = document.newChunks.map(chunk => `[${chunk.embedding.join(",")}]`);
      const reuseCounts = document.newChunks.map(chunk => chunk.reuseCount);
      const createdAts = document.newChunks.map(chunk => chunk.createdAt.toISOString());

      const inserted = await transaction`
        insert into public.documents (content, metadata, embedding, reuse_count, created_at, updated_at)
        select input.content, input.metadata::jsonb, input.embedding::vector,
               input.reuse_count, input.created_at, now()
        from unnest(
          ${contents}::text[],
          ${metadatas}::text[],
          ${embeddings}::text[],
          ${reuseCounts}::integer[],
          ${createdAts}::timestamptz[]
        ) as input(content, metadata, embedding, reuse_count, created_at)
        returning id
      `;
      if (inserted.length !== document.newChunks.length) throw new Error(`${document.title} 새 청크 저장 수가 일치하지 않습니다.`);

      // 과거 답변의 출처 기록을 유지한 뒤에만 기존 청크를 삭제합니다.
      await transaction`
        update public.chat_log_citations
        set document_id = ${Number(inserted[0].id)}
        where document_id = any(${document.oldIds}::bigint[])
      `;
      const deleted = await transaction`
        delete from public.documents where id = any(${document.oldIds}::bigint[]) returning id
      `;
      if (deleted.length !== document.oldIds.length) throw new Error(`${document.title} 기존 청크 삭제 수가 일치하지 않습니다.`);
    });
    completed.push({ title: document.title, oldChunks: document.oldChunks, newChunks: document.newChunks.length });
  }

  return { backupBatch, documents: completed, skipped };
}

function groupRows(rows: StoredRow[]) {
  const groups = new Map<string, StoredRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
}

function groupKey(row: StoredRow) {
  const metadata = asMetadata(row.metadata);
  return String(metadata.source_hash || `doc:${row.id}`);
}

function firstString(rows: StoredRow[], key: string) {
  for (const row of rows) {
    const value = asMetadata(row.metadata)[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return asMetadata(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safePriority(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed))) : 50;
}

