-- 레거시 문서 메타데이터 정규화
--
-- 교육 과정에서 적재된 청크의 metadata 는 { fileName, fileId, category } 형태입니다.
-- 앱은 title / source_hash / file_type 을 기준으로 문서를 묶고 출처를 표시하므로,
-- 없는 키만 채워 넣습니다. 이미 있는 키는 건드리지 않습니다.

update public.documents
set metadata = coalesce(metadata, '{}'::jsonb)
  || case
       when coalesce(metadata->>'title', '') <> '' then '{}'::jsonb
       else jsonb_build_object('title', coalesce(nullif(metadata->>'fileName', ''), '제목 없는 지식'))
     end
  || case
       when coalesce(metadata->>'source_hash', '') <> '' then '{}'::jsonb
       else jsonb_build_object('source_hash',
              'legacy:' || coalesce(nullif(metadata->>'fileId', ''),
                                    nullif(metadata->>'fileName', ''),
                                    id::text))
     end
  || case
       when coalesce(metadata->>'file_type', '') <> '' then '{}'::jsonb
       else jsonb_build_object('file_type', 'text')
     end
  || case
       when coalesce(metadata->>'category', '') <> '' then '{}'::jsonb
       else jsonb_build_object('category', '일반')
     end
where coalesce(metadata->>'title', '') = ''
   or coalesce(metadata->>'source_hash', '') = ''
   or coalesce(metadata->>'file_type', '') = ''
   or coalesce(metadata->>'category', '') = '';
