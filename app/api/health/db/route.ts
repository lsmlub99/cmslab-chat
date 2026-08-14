import { NextResponse } from "next/server";
import { database, hasDatabaseConfig } from "@/lib/database";
import { chatModel, embeddingModel, hasOpenAIConfig } from "@/lib/openai";
import { CANDIDATE_THRESHOLD, TOP_MATCH_THRESHOLD } from "@/lib/rag/config";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

/** 설정 점검용. DB 연결, 스키마, 임베딩 적재 상태를 한 번에 보여 줍니다. */
export async function GET() {
  const config = {
    database: hasDatabaseConfig(),
    openai: hasOpenAIConfig(),
    chatModel: chatModel(),
    embeddingModel: embeddingModel(),
    candidateThreshold: CANDIDATE_THRESHOLD,
    topMatchThreshold: TOP_MATCH_THRESHOLD,
  };

  if (!config.database) {
    return NextResponse.json(
      { ok: false, config, error: ".env.local의 DATABASE_URL에 Supabase 비밀번호를 입력해 주세요." },
      { status: 503 },
    );
  }

  try {
    const sql = database();
    const [connection] = await sql`select current_database() as database, current_user as "user", now() as connected_at`;

    const [documents] = await sql`
      select count(*)::int as chunks,
             count(embedding)::int as embedded,
             count(distinct coalesce(nullif(metadata->>'source_hash', ''), 'doc:' || id::text))::int as documents
      from public.documents
    `;

    const tables = await sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('documents', 'chat_logs', 'feedback', 'chat_log_citations', 'workspace_settings')
    `;
    const present = new Set(tables.map(row => String(row.table_name)));
    const missingTables = ["documents", "chat_logs", "feedback", "chat_log_citations", "workspace_settings"]
      .filter(name => !present.has(name));

    const [searchFunction] = await sql`
      select count(*)::int as found from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'match_documents_answerbot'
    `;

    const migrationsApplied = missingTables.length === 0 && Number(searchFunction.found) > 0;

    return NextResponse.json({
      ok: migrationsApplied,
      config,
      connection,
      documents,
      migrationsApplied,
      ...(missingTables.length ? { missingTables } : {}),
      ...(migrationsApplied ? {} : { hint: "supabase/migrations 의 SQL을 순서대로 적용해 주세요." }),
      ...(Number(documents.embedded) < Number(documents.chunks)
        ? { warning: `임베딩이 없는 청크가 ${Number(documents.chunks) - Number(documents.embedded)}개 있습니다. 벡터 검색에 걸리지 않습니다.` }
        : {}),
    });
  } catch (error) {
    const detail = error as { message?: string; code?: string; name?: string };
    return NextResponse.json(
      { ok: false, config, error: detail.message || "PostgreSQL 연결에 실패했습니다.", code: detail.code },
      { status: 503 },
    );
  }
}
