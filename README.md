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

## Slackbot MCP 연결

이 앱은 `POST /api/mcp`에 Slackbot용 원격 MCP 서버를 제공합니다. Slack 앱을 만들 때
`slack-app-manifest.yaml`의 예시 도메인을 실제 HTTPS 배포 주소로 바꾸고 앱 manifest에
등록하세요. MCP 서버 인증 방식은 `Slack identity auth`입니다.

배포 환경에는 기존 설정과 함께 `SLACK_SIGNING_SECRET`을 추가하고,
`supabase/migrations/004_slack_mcp.sql`을 적용해야 합니다. MCP 엔드포인트는 Slack 요청의
서명과 5분 timestamp 창을 검증하며, Slack이 넣어 주는 사용자·워크스페이스 ID로 호출 수와
고유 사용자 수를 집계합니다.

등록 도구는 읽기 전용 `ask_company_knowledge` 하나입니다. `initialize`, `tools/list` 같은
프로토콜 요청은 KPI에 포함하지 않고, 서명 검증을 통과한 중복 없는 `tools/call`만
`public.mcp_tool_calls`에 기록합니다. 관리자 대시보드에서 호출 수, 성공 호출, 고유 사용자,
성공률을 확인할 수 있습니다.
