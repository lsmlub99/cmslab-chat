import { EMBEDDING_DIMENSIONS, embeddingModel, openai } from "@/lib/openai";

const BATCH_SIZE = 64;

/** 임베딩 입력은 토큰 상한이 있어 아주 긴 청크는 잘라서 보냅니다. */
const MAX_INPUT_CHARS = 24_000;

export async function embedTexts(texts: string[]) {
  if (!texts.length) return [] as number[][];
  const client = openai();
  const result: number[][] = [];

  for (let index = 0; index < texts.length; index += BATCH_SIZE) {
    const batch = texts
      .slice(index, index + BATCH_SIZE)
      .map(text => text.slice(0, MAX_INPUT_CHARS) || " ");

    const model = embeddingModel();
    const response = await client.embeddings.create({
      model,
      input: batch,
      // dimensions 는 text-embedding-3 계열에서만 지원합니다(ada-002 는 거부).
      ...(model.includes("-3-") ? { dimensions: EMBEDDING_DIMENSIONS } : {}),
    });

    const ordered = [...response.data].sort((a, b) => a.index - b.index);
    for (const item of ordered) {
      if (item.embedding.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(
          `임베딩 차원이 ${item.embedding.length}입니다. public.documents.embedding 은 vector(${EMBEDDING_DIMENSIONS}) 이므로 OPENAI_EMBEDDING_MODEL 을 확인해 주세요.`,
        );
      }
      result.push(item.embedding);
    }
  }

  return result;
}

export async function embedQuery(text: string) {
  const [embedding] = await embedTexts([text]);
  return embedding;
}
