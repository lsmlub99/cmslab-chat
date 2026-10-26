import "server-only";

import { chatModel, openai } from "@/lib/openai";
import { errorCodeOf } from "@/lib/rag/ai-error";
import { logAiCall } from "@/lib/server/telemetry.server";
import { parseAliases } from "@/lib/rag/aliases-parser";
import { deterministicSearchAliases, mergeSearchAliases } from "@/lib/rag/deterministic-aliases";

type AliasChunk = { content: string; section?: string | null };

const BATCH_SIZE = 18;
const MAX_CONTENT_CHARS = 650;

/**
 * 문서를 등록할 때 한 번만, 실제 직원이 물을 법한 표현을 생성합니다.
 * 답변 근거로는 쓰지 않고 검색용 메타데이터와 임베딩 입력에만 사용합니다.
 */
export async function generateSearchAliases(input: {
  title: string;
  category: string;
  chunks: AliasChunk[];
}) {
  if (!input.chunks.length) return [] as string[][];

  const aliases = Array.from({ length: input.chunks.length }, () => [] as string[]);
  for (let offset = 0; offset < input.chunks.length; offset += BATCH_SIZE) {
    const batch = input.chunks.slice(offset, offset + BATCH_SIZE);
    const generated = await generateAliasBatch({ ...input, chunks: batch });
    generated.forEach((values, index) => {
      const chunk = batch[index];
      aliases[offset + index] = mergeSearchAliases(values, deterministicSearchAliases({
        title: input.title,
        category: input.category,
        section: chunk.section,
        content: chunk.content,
      }));
    });
  }
  return aliases;
}

async function generateAliasBatch(input: {
  title: string;
  category: string;
  chunks: AliasChunk[];
}) {

  const model = chatModel();
  const started = Date.now();
  let success = false;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let errorCode: string | undefined;

  try {
    const entries = input.chunks.map((chunk, index) =>
      `[${index}] ${chunk.section ? `섹션: ${chunk.section}\n` : ""}${chunk.content.slice(0, MAX_CONTENT_CHARS)}`,
    );
    const response = await openai().responses.create({
      model,
      instructions: `사내 지식 검색용 질문 별칭을 만듭니다. 각 청크마다 직원이 실제로 물을 법한 짧은 한국어 질문·표현을 3~8개 만드세요.
본문에 없는 사실은 만들지 말고, 답변도 쓰지 마세요. 구어체·약칭·상황 설명을 섞으세요.
반드시 각 줄을 "청크번호<TAB>표현1 | 표현2 | 표현3" 형식으로만 출력하세요.`,
      input: `문서 제목: ${input.title}\n카테고리: ${input.category}\n\n${entries.join("\n\n")}`,
      max_output_tokens: 1_200,
    });

    success = true;
    inputTokens = response.usage?.input_tokens;
    outputTokens = response.usage?.output_tokens;
    return parseAliases(response.output_text ?? "", input.chunks.length);
  } catch (error) {
    errorCode = errorCodeOf(error);
    return Array.from({ length: input.chunks.length }, () => [] as string[]);
  } finally {
    await logAiCall({
      provider: "openai",
      model,
      success,
      latencyMs: Date.now() - started,
      inputTokens,
      outputTokens,
      errorCode,
    }).catch(() => undefined);
  }
}


