import OpenAI from "openai";

let client: OpenAI | undefined;

export function hasOpenAIConfig() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function openai() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error(".env.local의 OPENAI_API_KEY를 입력해 주세요.");
  client ??= new OpenAI({ apiKey, maxRetries: 2, timeout: 60_000 });
  return client;
}

export const chatModel = () => process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini";
export const embeddingModel = () => process.env.OPENAI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

/**
 * public.documents.embedding 이 vector(1536) 이므로 임베딩 모델 차원이 반드시 1536이어야 합니다.
 * text-embedding-3-large(3072)로 바꾸려면 컬럼 타입과 기존 36개 청크를 함께 재적재해야 합니다.
 */
export const EMBEDDING_DIMENSIONS = 1536;
