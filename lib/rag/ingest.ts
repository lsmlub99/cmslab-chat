import crypto from "node:crypto";
import { extractText, normalizeText } from "@/lib/rag/extract";
import { chunkText } from "@/lib/rag/chunk";
import { embedTexts } from "@/lib/rag/embeddings";
import { deleteBySourceHash, insertDocumentChunks } from "@/lib/existing-db";
import { database } from "@/lib/database";

type IngestInput = {
  title: string;
  category?: string;
  filename: string;
  buffer: Buffer;
  sourceLabel?: string;
  sourceUrl?: string;
  /** 같은 내용이 이미 있으면 덮어씁니다(수정 저장에 사용). */
  replace?: boolean;
};

export async function ingestKnowledge(input: IngestInput) {
  const hash = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const sql = database();

  const existing = await sql`
    select count(*)::int as chunks from public.documents where metadata->>'source_hash' = ${hash}
  `;
  if (Number(existing[0]?.chunks ?? 0) > 0) {
    if (!input.replace) {
      throw new Error("같은 내용의 문서가 이미 등록되어 있습니다.");
    }
    await deleteBySourceHash(hash);
  }

  const raw = normalizeText(await extractText(input.buffer, input.filename));
  const pageParts = raw.split(/\[PAGE_BREAK\]/).map(part => part.trim()).filter(Boolean);
  const sourceParts = pageParts.length > 1 ? pageParts : [raw];

  const chunks = sourceParts
    .flatMap((part, pageIndex) =>
      chunkText(part).map(chunk => ({ ...chunk, page: pageParts.length > 1 ? pageIndex + 1 : undefined })),
    )
    .map((chunk, index) => ({ ...chunk, index }));

  if (!chunks.length) throw new Error("문서에서 읽을 수 있는 텍스트가 없습니다.");

  // 임베딩을 여기서 만들어 두지 않으면 새 문서는 벡터 검색에 절대 걸리지 않습니다.
  const embeddings = await embedTexts(chunks.map(chunk => chunk.content));
  if (embeddings.length !== chunks.length) {
    throw new Error("임베딩 생성 결과가 청크 수와 맞지 않습니다. 다시 시도해 주세요.");
  }

  const fileType = input.filename.split(".").pop()?.toLowerCase() || "text";
  const rows = chunks.map((chunk, index) => ({
    content: chunk.content,
    embedding: embeddings[index],
    metadata: {
      title: input.title,
      category: input.category || "일반",
      file_type: fileType,
      source_hash: hash,
      source_label: input.sourceLabel || null,
      source_url: input.sourceUrl || null,
      chunk_index: index,
      token_count: chunk.tokenCount,
      page: chunk.page ?? null,
      section: chunk.section ?? null,
      status: "ready",
    },
  }));

  const ids = await insertDocumentChunks(rows);

  return {
    duplicate: false,
    document: {
      id: ids[0],
      title: input.title,
      status: "ready" as const,
      chunks: rows.length,
      source_hash: hash,
    },
  };
}
