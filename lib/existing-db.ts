import { database } from "@/lib/database";
import { embedQuery } from "@/lib/rag/embeddings";
import { ftsQuery, keywordTerms } from "@/lib/rag/query";
import { expandForEmbedding, expandTerms } from "@/lib/rag/synonyms";
import { expandQuestion } from "@/lib/rag/expand";
import { CANDIDATE_COUNT, CANDIDATE_THRESHOLD, MATCH_COUNT } from "@/lib/rag/config";

export type ExistingDocument = {
  id: number;
  title: string;
  category: string;
  file_type: string;
  status: "ready";
  error_message: null;
  reuse_count: number;
  created_at: string;
  updated_at: string;
  chunks: number;
  /** 임베딩이 채워진 청크 수. chunks 와 다르면 검색이 반쪽만 됩니다. */
  embedded: number;
  source_hash: string;
};

export type SearchRow = {
  id: number;
  content: string;
  metadata: Record<string, unknown>;
  /** 코사인 유사도 (0~1). 임계값 판정과 출처 표시에 사용합니다. */
  similarity: number;
  matchedLexically: boolean;
  /** 질문에서 뽑은 키워드 중 이 청크에 걸린 개수. */
  keywordHits: number;
};

type RawSearchRow = {
  id: string | number;
  content: string | null;
  metadata: unknown;
  similarity: string | number | null;
  score: string | number | null;
  matched_lexically: boolean | null;
  keyword_hits: string | number | null;
};

/**
 * 키워드가 몇 개 이상 걸려야 "의미 있는 어휘 일치"로 볼지.
 * 1개만 걸린 경우는 흔한 단어의 우연한 일치일 가능성이 큽니다.
 * (예: "내일 서울 날씨 어때?" 의 "내일" 이 사내 문서에 우연히 들어 있는 경우)
 */
export const STRONG_KEYWORD_HITS = 2;

/** 청크가 근거로 쓸 만한지 — 유사도가 높거나, 키워드가 여러 개 걸렸거나. */
export function isStrongMatch(row: SearchRow, threshold: number) {
  return row.similarity >= threshold || row.keywordHits >= STRONG_KEYWORD_HITS;
}

/**
 * 하이브리드 검색: 임베딩(벡터) + FTS + 키워드 부분일치를 RRF로 융합합니다.
 *
 * 벡터가 주 신호입니다. FTS/키워드는 고유명사(예: "리페라", "CMS_GUEST_WIFI")처럼
 * 임베딩이 약한 질문을 건지기 위한 보조 신호입니다.
 * 임베딩 호출이 실패하면 키워드 검색만으로 조용히 내려앉습니다.
 */
export async function searchDocuments(question: string, limit = MATCH_COUNT) {
  const terms = keywordTerms(question);

  /*
   * 같은 뜻의 다른 낱말을 함께 검색합니다.
   * 키워드 검색은 글자가 같아야 걸리므로 "휴가"로는 "연차" 문서를 못 찾습니다.
   * 임베딩도 만능이 아니어서 "부의금"으로 경조사 문서를, "랩탑"으로 노트북 문서를
   * 상위 8위 안에도 못 올렸습니다. 사전을 붙이자 둘 다 1위가 됐고 지연은 없습니다.
   */
  const expandedTerms = expandTerms(terms);
  const embeddingText = expandForEmbedding(question, terms);

  const embedding = await embedQuery(embeddingText).catch(() => null);
  if (!embedding) return keywordOnlySearch(question, expandedTerms, limit);

  return runSearch(embedding, question, expandedTerms, limit);
}

async function runSearch(embedding: number[], question: string, terms: string[], limit: number) {
  const sql = database();
  const rows = (await sql`
    select * from public.match_documents_answerbot(
      ${toVector(embedding)}::vector,
      ${ftsQuery(question)},
      ${terms}::text[],
      ${limit * 3},
      ${CANDIDATE_COUNT}
    )
  `) as unknown as RawSearchRow[];

  return rankAndTrim(rows, limit);
}

/**
 * 사전으로도 못 찾았을 때 한 번 더 시도합니다.
 *
 * 모델에게 동의어를 만들게 하면 사전에 없는 낱말까지 잡히지만 호출이 하나 더 붙습니다.
 * 그래서 평소에는 쓰지 않고, 근거를 못 찾아 미답변으로 넘어가기 직전에만 씁니다.
 * 잘 찾은 질문은 그대로 빠르고, 못 찾은 질문만 조금 더 기다립니다.
 */
export async function searchWithExpansion(question: string, limit = MATCH_COUNT) {
  const expanded = await expandQuestion(question);
  if (!expanded) return [] as SearchRow[];

  const terms = expandTerms(keywordTerms(`${question} ${expanded}`));
  const embedding = await embedQuery(`${question} ${expanded}`).catch(() => null);
  if (!embedding) return [] as SearchRow[];

  return runSearch(embedding, question, terms, limit);
}

/** 임베딩을 못 쓸 때의 대비책 — 키워드/FTS만으로 찾습니다. */
async function keywordOnlySearch(question: string, terms: string[], limit: number) {
  const sql = database();
  if (!terms.length) return [] as SearchRow[];

  const rows = (await sql`
    select d.id, d.content, d.metadata,
           0::float8 as similarity,
           m.hits::float8 as score,
           true as matched_lexically,
           m.hits::integer as keyword_hits
    from public.documents d
    cross join lateral (
      select count(*) as hits
      from unnest(${terms}::text[]) as t(term)
      where d.content ilike '%' || term || '%'
         or coalesce(d.metadata->>'title', '') ilike '%' || term || '%'
         or coalesce(d.metadata->>'category', '') ilike '%' || term || '%'
    ) m
    where m.hits > 0
       or d.content_fts @@ websearch_to_tsquery('simple', ${ftsQuery(question)})
    order by m.hits desc, d.id desc
    limit ${limit}
  `) as unknown as RawSearchRow[];

  // 임베딩이 없어 유사도가 전부 0 이므로 여기서 다시 걸러낼 근거가 없습니다.
  // 위 WHERE 절이 이미 키워드/FTS 로 관련 있는 행만 남겼으니 그대로 통과시킵니다.
  // (2개 이상을 요구하면 한 단어 질문 "경조사"가, 1개를 요구하면 FTS 전용 매칭이 탈락합니다.)
  return rankAndTrim(rows, limit, 0);
}

/**
 * 임계값을 적용하고, 거의 같은 내용의 청크를 접은 뒤 유사도 순으로 정렬합니다.
 *
 * RRF 점수는 후보를 폭넓게 건지는 데 쓰고, 최종 순서는 코사인 유사도로 다시 잡습니다.
 * RRF 순서를 그대로 쓰면 정작 정답 문단이 [출처 2]로 밀려나는 일이 생깁니다.
 * (교육용 데이터에는 같은 문단이 중복 적재된 청크가 있어 근거가 낭비되므로 함께 접습니다.)
 */
function rankAndTrim(rows: RawSearchRow[], limit: number, minKeywordHits = STRONG_KEYWORD_HITS) {
  const seen = new Set<string>();
  const candidates: SearchRow[] = [];

  for (const row of rows) {
    const content = row.content ?? "";
    if (!content.trim()) continue;

    const keywordHits = Number(row.keyword_hits ?? 0);
    const similarity = Number(row.similarity ?? 0);
    if (similarity < CANDIDATE_THRESHOLD && keywordHits < minKeywordHits) continue;

    const fingerprint = content.replace(/\s+/g, "").slice(0, 120);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    candidates.push({
      id: Number(row.id),
      content,
      metadata: asMetadata(row.metadata),
      similarity,
      matchedLexically: Boolean(row.matched_lexically),
      keywordHits,
    });
  }

  return candidates
    .sort((a, b) => rankScore(b) - rankScore(a))
    .slice(0, limit);
}

/**
 * 정렬 점수 = 코사인 유사도 + 키워드 가산점.
 *
 * 코사인만으로 정렬하면 질문의 핵심 단어를 그대로 담고 있는 문단이 밀립니다.
 * 실제로 "개인정보 들어간 서류 어떻게 버려?" 에서 정답 문서(개인정보 폐기 안내)가
 * 0.264로 8위였고, 무관한 IT 문단이 0.372로 1위였습니다.
 * 반대로 키워드만 보면 흔한 단어의 우연한 일치에 끌려갑니다.
 * 그래서 코사인을 주 신호로 두되 키워드 일치에 작은 가산점을 줍니다.
 */
function rankScore(row: SearchRow) {
  return row.similarity + 0.03 * Math.min(row.keywordHits, 3);
}

/** pgvector 는 '[0.1,0.2,...]' 형태의 문자열을 vector 로 캐스팅합니다. */
function toVector(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}

/**
 * 청크를 한 번의 쿼리로 적재합니다.
 *
 * 캐스팅을 반드시 명시해야 합니다. metadata 를 캐스트 없이 문자열로 넘기면
 * jsonb 스칼라 문자열("{\"title\":...}")로 저장되어 metadata->>'title' 이 전부 null 이 됩니다.
 * 그러면 문서 묶기·중복 검사·source_hash 삭제가 조용히 망가집니다.
 */
export async function insertDocumentChunks(
  chunks: { content: string; metadata: Record<string, unknown>; embedding: number[] | null }[],
) {
  if (!chunks.length) return [] as number[];
  const sql = database();

  const contents = chunks.map(chunk => chunk.content);
  const metadatas = chunks.map(chunk => JSON.stringify(chunk.metadata));
  const embeddings = chunks.map(chunk => (chunk.embedding ? toVector(chunk.embedding) : null));

  const rows = (await sql`
    insert into public.documents (content, metadata, embedding)
    select input.content, input.metadata::jsonb, nullif(input.embedding, '')::vector
    from unnest(
      ${contents}::text[],
      ${metadatas}::text[],
      ${embeddings.map(value => value ?? "")}::text[]
    ) as input(content, metadata, embedding)
    returning id
  `) as unknown as { id: string | number }[];

  return rows.map(row => Number(row.id)).sort((a, b) => a - b);
}

/**
 * 문서(= 업로드 단위) 묶음 키.
 * 003 마이그레이션이 모든 청크에 source_hash 를 채워 두므로 보통 그 값을 씁니다.
 * 혹시 비어 있는 청크가 새로 생겨도 id 로 단독 그룹이 되도록 coalesce 를 둡니다.
 */
const GROUP_KEY = "coalesce(nullif(metadata->>'source_hash', ''), 'doc:' || id::text)";

export async function listDocumentGroups(): Promise<ExistingDocument[]> {
  const sql = database();
  const rows = (await sql`
    select ${sql.unsafe(GROUP_KEY)} as source_hash,
           min(id)::bigint as id,
           coalesce(max(metadata->>'title'), max(metadata->>'fileName'), '제목 없는 지식') as title,
           coalesce(max(metadata->>'category'), '일반') as category,
           coalesce(max(metadata->>'file_type'), 'text') as file_type,
           coalesce(sum(reuse_count), 0)::int as reuse_count,
           count(*)::int as chunks,
           count(embedding)::int as embedded,
           min(created_at) as created_at,
           max(updated_at) as updated_at
    from public.documents
    group by ${sql.unsafe(GROUP_KEY)}
    order by max(updated_at) desc, min(id) desc
  `) as unknown as Record<string, unknown>[];

  return rows.map(row => ({
    id: Number(row.id),
    source_hash: String(row.source_hash),
    title: String(row.title),
    category: String(row.category),
    file_type: String(row.file_type),
    status: "ready" as const,
    error_message: null,
    reuse_count: Number(row.reuse_count),
    chunks: Number(row.chunks),
    embedded: Number(row.embedded),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  }));
}

export async function deleteDocumentGroup(id: number) {
  const sql = database();
  const rows = await sql`select ${sql.unsafe(GROUP_KEY)} as source_hash from public.documents where id = ${id} limit 1`;
  if (!rows.length) throw new Error("문서를 찾지 못했습니다.");
  const deleted = await sql`delete from public.documents where ${sql.unsafe(GROUP_KEY)} = ${String(rows[0].source_hash)} returning id`;
  return deleted.length;
}

export async function deleteBySourceHash(sourceHash: string) {
  const sql = database();
  const deleted = await sql`delete from public.documents where metadata->>'source_hash' = ${sourceHash} returning id`;
  return deleted.length;
}

/** 인용된 청크의 재사용 횟수를 한 번에 올립니다. */
export async function incrementReuse(documentIds: number[]) {
  if (!documentIds.length) return;
  await database()`select public.increment_document_reuse(${documentIds}::bigint[])`;
}

export function documentTitle(metadata: Record<string, unknown>) {
  return String(metadata.title || metadata.fileName || "팀 지식 문서");
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try { return asMetadata(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toIsoString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : "";
}
