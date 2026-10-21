import crypto from "node:crypto";
import { extractText, normalizeText } from "@/lib/rag/extract";
import { chunkText } from "@/lib/rag/chunk";
import { embedTexts } from "@/lib/rag/embeddings";
import { deleteBySourceHash, insertDocumentChunks } from "@/lib/existing-db";
import { database } from "@/lib/database";
import { redactSensitiveText } from "@/lib/rag/redact";
import { extractUrls } from "@/lib/rag/links";
import { generateSearchAliases } from "@/lib/rag/aliases";

type IngestInput = {
  title: string;
  category?: string;
  filename: string;
  buffer: Buffer;
  sourceLabel?: string;
  sourceUrl?: string;
  owner?: string;
  effectiveDate?: string;
  expiresAt?: string;
  authority?: "official" | "reference" | "draft";
  priority?: number;
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

  const raw = redactSensitiveText(normalizeText(await extractText(input.buffer, input.filename)));
  const pageParts = raw.split(/\[PAGE_BREAK\]/).map(part => part.trim()).filter(Boolean);
  const sourceParts = pageParts.length > 1 ? pageParts : [raw];

  const chunks = sourceParts
    .flatMap((part, pageIndex) =>
      chunkText(part).map(chunk => ({ ...chunk, page: pageParts.length > 1 ? pageIndex + 1 : undefined })),
    )
    .map((chunk, index) => ({ ...chunk, index }));

  if (!chunks.length) throw new Error("문서에서 읽을 수 있는 텍스트가 없습니다.");

  // 업로드 때 한 번만 질문 표현을 생성합니다. 검색에는 쓰되 답변 근거에는 섞지 않습니다.
  const aliases = await generateSearchAliases({
    title: input.title,
    category: input.category || "일반",
    chunks,
  });

  // 제목·분류·섹션·질문 별칭을 함께 임베딩하면 본문과 표현이 다른 질문도 잘 찾습니다.
  // 실제 모델 답변에는 아래 검색용 문자열이 아니라 원문 content만 전달됩니다.
  const embeddings = await embedTexts(chunks.map((chunk, index) => [
    `문서: ${input.title}`,
    `분류: ${input.category || "일반"}`,
    chunk.section ? `섹션: ${chunk.section}` : "",
    aliases[index]?.length ? `검색 표현: ${aliases[index].join(" / ")}` : "",
    chunk.content,
  ].filter(Boolean).join("\n")));
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
      // 별도 출처를 입력하지 않아도 해당 청크의 첫 링크를 근거 링크로 보존합니다.
      source_url: input.sourceUrl || extractUrls(chunk.content)[0] || null,
      chunk_index: index,
      token_count: chunk.tokenCount,
      page: chunk.page ?? null,
      section: chunk.section ?? null,
      search_aliases: aliases[index] ?? [],
      owner: input.owner || null,
      effective_date: input.effectiveDate || null,
      expires_at: input.expiresAt || null,
      authority: input.authority || "reference",
      priority: Math.min(100, Math.max(0, input.priority ?? 50)),
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
