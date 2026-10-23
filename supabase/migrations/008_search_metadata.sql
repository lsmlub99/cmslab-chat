-- 섹션명과 검색 별칭도 키워드 후보 선정에 포함합니다.
--
-- 재청킹된 문서는 질문형 섹션명과 search_aliases 에 실제 사용자의 다양한 표현을
-- 보존합니다. 기존 함수는 본문/제목/카테고리만 검사해서 정확한 섹션이 DB 후보에서
-- 탈락할 수 있었습니다.
drop function if exists public.match_documents_answerbot(vector, text, text[], integer, integer);

create or replace function public.match_documents_answerbot(
  query_embedding vector(1536),
  query_text text,
  keyword_terms text[] default '{}',
  match_count integer default 8,
  candidate_count integer default 40
)
returns table(
  id bigint,
  content text,
  metadata jsonb,
  similarity double precision,
  score double precision,
  matched_lexically boolean,
  keyword_hits integer
)
language sql stable as $$
  with vec as (
    select d.id,
           1 - (d.embedding <=> query_embedding) as cos,
           row_number() over (order by d.embedding <=> query_embedding) as rnk
    from public.documents d
    where d.embedding is not null
    order by d.embedding <=> query_embedding
    limit candidate_count
  ),
  fts as (
    select d.id,
           row_number() over (
             order by ts_rank(d.content_fts, websearch_to_tsquery('simple', query_text)) desc, d.id
           ) as rnk
    from public.documents d
    where query_text <> ''
      and d.content_fts @@ websearch_to_tsquery('simple', query_text)
    limit candidate_count
  ),
  kw as (
    select d.id, hits,
           row_number() over (order by hits desc, d.id) as rnk
    from public.documents d
    cross join lateral (
      select count(*) as hits
      from unnest(keyword_terms) as t(term)
      where d.content ilike '%' || term || '%'
         or coalesce(d.metadata->>'title', '') ilike '%' || term || '%'
         or coalesce(d.metadata->>'category', '') ilike '%' || term || '%'
         or coalesce(d.metadata->>'section', '') ilike '%' || term || '%'
         or coalesce(d.metadata->>'search_aliases', '') ilike '%' || term || '%'
    ) m
    where cardinality(keyword_terms) > 0 and m.hits > 0
    order by hits desc, d.id
    limit candidate_count
  )
  select d.id,
         d.content,
         d.metadata,
         coalesce(v.cos, 1 - (d.embedding <=> query_embedding), 0)::double precision as similarity,
         (coalesce(1.0 / (60 + v.rnk), 0)
            + coalesce(1.0 / (60 + f.rnk), 0)
            + coalesce(1.0 / (60 + k.rnk), 0))::double precision as score,
         (f.id is not null or k.id is not null) as matched_lexically,
         coalesce(k.hits, 0)::integer as keyword_hits
  from public.documents d
  left join vec v on v.id = d.id
  left join fts f on f.id = d.id
  left join kw  k on k.id = d.id
  where v.id is not null or f.id is not null or k.id is not null
  order by score desc, similarity desc
  limit match_count;
$$;
