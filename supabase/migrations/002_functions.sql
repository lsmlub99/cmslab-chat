-- 검색·집계 함수
--
-- 기존 match_documents / match_documents_hybrid 는 그대로 남겨두고,
-- 앱이 사용할 하이브리드 검색 함수를 새로 정의합니다.
--
-- 왜 새로 만드는가:
--  1) 기존 match_documents_hybrid 는 RRF 점수(≈0.03)를 similarity 로 반환합니다.
--     앱의 유사도 임계값·출처 표시는 코사인 유사도를 기대하므로 값의 의미가 어긋납니다.
--  2) 한국어는 조사 때문에 to_tsvector('simple') 매칭이 거의 안 걸립니다.
--     그래서 벡터 + FTS 에 ilike 부분일치(트라이그램) 신호를 하나 더 섞습니다.
--
-- 반환값:
--  similarity : 실제 코사인 유사도 (임계값·출처 표시용)
--  score      : RRF 융합 점수 (정렬용)
--  matched_lexically : 키워드/FTS 로 걸린 문서인지 (임계값 우회 허용용)

-- 반환 컬럼이 바뀌면 CREATE OR REPLACE 로는 교체할 수 없어 먼저 지웁니다.
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
         -- 몇 개의 키워드가 걸렸는지. 1개만 걸린 것(흔한 단어 우연 일치)과
         -- 여러 개가 걸린 것을 앱에서 구분하려고 함께 돌려줍니다.
         coalesce(k.hits, 0)::integer as keyword_hits
  from public.documents d
  left join vec v on v.id = d.id
  left join fts f on f.id = d.id
  left join kw  k on k.id = d.id
  where v.id is not null or f.id is not null or k.id is not null
  order by score desc, similarity desc
  limit match_count;
$$;

/**
 * 속도 제한 카운터를 원자적으로 올리고 현재 값을 돌려줍니다.
 *
 * 여러 인스턴스가 동시에 호출해도 한 행에 대한 upsert 라 경쟁 상태가 없습니다.
 * 창(window)이 지났으면 1로 리셋합니다.
 */
create or replace function public.bump_rate_limit(
  limit_key text,
  window_seconds integer
)
returns table(hits integer, window_start timestamptz)
language plpgsql volatile as $$
begin
  return query
  insert into public.rate_limits as r (key, window_start, count)
  values (limit_key, now(), 1)
  on conflict (key) do update set
    count = case
      when r.window_start < now() - make_interval(secs => window_seconds) then 1
      else r.count + 1
    end,
    window_start = case
      when r.window_start < now() - make_interval(secs => window_seconds) then now()
      else r.window_start
    end
  returning r.count, r.window_start;
end;
$$;

-- 답변에 인용된 문서의 재사용 횟수를 올립니다.
create or replace function public.increment_document_reuse(document_ids bigint[])
returns void language sql volatile as $$
  update public.documents
  set reuse_count = coalesce(reuse_count, 0) + 1,
      updated_at = now()
  where id = any(document_ids);
$$;
