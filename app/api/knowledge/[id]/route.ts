import { NextResponse } from "next/server";
import { deleteBySourceHash, deleteDocumentGroup } from "@/lib/existing-db";
import { ingestKnowledge } from "@/lib/rag/ingest";
import { database } from "@/lib/database";
import { editKnowledgeSchema } from "@/lib/validation";

export const runtime = "nodejs";
// Vercel 무료(Hobby) 플랜 상한이 60초입니다.
export const maxDuration = 60;

type Context = { params: Promise<{ id: string }> };

/** 문서(청크 묶음) 전체를 하나로 합쳐 돌려줍니다 — 수정 화면에서 사용합니다. */
export async function GET(_: Request, context: Context) {
  try {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 문서 번호입니다." }, { status: 400 });

    const sql = database();
    const target = await sql`select metadata from public.documents where id = ${id} limit 1`;
    if (!target.length) return NextResponse.json({ error: "지식을 찾지 못했습니다." }, { status: 404 });

    const metadata = (target[0].metadata ?? {}) as Record<string, unknown>;
    const sourceHash = metadata.source_hash ? String(metadata.source_hash) : "";

    const chunks = sourceHash
      ? await sql`
          select id, content, metadata from public.documents
          where metadata->>'source_hash' = ${sourceHash}
          order by coalesce((metadata->>'chunk_index')::int, id)
        `
      : await sql`select id, content, metadata from public.documents where id = ${id}`;

    return NextResponse.json({
      id,
      title: String(metadata.title || metadata.fileName || "제목 없는 지식"),
      category: String(metadata.category || "일반"),
      source_hash: sourceHash,
      source_label: metadata.source_label ? String(metadata.source_label) : "",
      source_url: metadata.source_url ? String(metadata.source_url) : "",
      chunks: chunks.length,
      body: chunks.map(chunk => String(chunk.content ?? "")).join("\n\n"),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "지식을 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}

export async function DELETE(_: Request, context: Context) {
  try {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 문서 번호입니다." }, { status: 400 });
    const removed = await deleteDocumentGroup(id);
    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "삭제하지 못했습니다." },
      { status: 400 },
    );
  }
}

/**
 * 문서 본문 수정 = 기존 청크 묶음을 지우고 새로 청킹·임베딩합니다.
 * 새 내용을 먼저 적재한 뒤 옛 청크를 지우면 중간에 실패해도 지식이 사라지지 않습니다.
 */
export async function PATCH(request: Request, context: Context) {
  try {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 문서 번호입니다." }, { status: 400 });

    const parsed = editKnowledgeSchema.parse(await request.json());
    const sql = database();
    const previous = await sql`select metadata from public.documents where id = ${id} limit 1`;
    if (!previous.length) return NextResponse.json({ error: "지식을 찾지 못했습니다." }, { status: 404 });

    const metadata = (previous[0].metadata ?? {}) as Record<string, unknown>;
    const oldHash = metadata.source_hash ? String(metadata.source_hash) : "";
    const title = parsed.title || String(metadata.title || metadata.fileName || "수정된 지식");

    const saved = await ingestKnowledge({
      title,
      category: parsed.category || String(metadata.category || "일반"),
      filename: `${title}.md`,
      buffer: Buffer.from(parsed.body, "utf8"),
      sourceLabel: parsed.sourceLabel,
      sourceUrl: parsed.sourceUrl || undefined,
      // 내용이 그대로면 해시가 같습니다. 그때는 제자리 교체로 처리합니다.
      replace: true,
    });

    if (oldHash && oldHash !== saved.document.source_hash) await deleteBySourceHash(oldHash);
    else if (!oldHash) await deleteDocumentGroup(id).catch(() => undefined);

    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { message: string }[] }).issues;
    if (issues?.length) return issues[0].message;
  }
  return error instanceof Error ? error.message : "수정하지 못했습니다.";
}
