# 답봇 · 반복 질문 지식베이스

팀 문서를 업로드하면 텍스트를 의미 단위로 청크화하고, Supabase PostgreSQL 전문검색과 GPT-5.6 Luna로 근거 기반 답변을 생성하는 Next.js 앱입니다.

## 시작하기

```powershell
Copy-Item .env.example .env.local
npm install
npx next dev
```

`.env.local`의 `DATABASE_URL`에서 `[YOUR_PASSWORD]` 부분만 실제 비밀번호로 교체하세요. URL 전체는 큰따옴표로 감싸져 있어 `#`가 주석으로 처리되지 않으며, 앱이 비밀번호 부분을 자동으로 URL 인코딩합니다. 연결 확인은 `http://localhost:3000/api/health/db`에서 할 수 있습니다.

현재 앱은 기존 `public.documents`, `public.chat_logs`, `public.feedback` 테이블을 사용하도록 연결되어 있습니다. 기존 프로젝트에서는 `supabase/migrations/001_rag.sql`을 바로 실행하지 마세요. 이 파일은 신규 프로젝트용 참고 스키마입니다.

- 사용자 채팅: `http://localhost:3000/`
- 관리자 화면: `http://localhost:3000/admin`

현재 관리자 화면은 인증 전 데모 모드입니다. 실제 배포 전 Supabase Auth와 RLS를 추가해야 합니다.

## 데이터 흐름

`문서 업로드 → 텍스트 추출 → 700~900토큰 청크 → documents.content + metadata 저장 → content_fts·부분일치 검색 → 최대 8개 청크 → Responses API 스트리밍 답변`

API 키는 서버 라우트에서만 사용하며 브라우저로 전달하지 않습니다.
