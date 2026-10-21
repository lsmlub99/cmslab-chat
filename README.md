# 답봇 · 반복 질문 지식베이스

팀 문서를 업로드하면 텍스트를 의미 단위로 청크화하고, Supabase PostgreSQL 전문검색과 GPT-4o mini로 근거 기반 답변을 생성하는 Next.js 앱입니다.

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

`문서 업로드 → 인증정보 마스킹 → 제목·Q&A 단위 청크 → 질문 별칭 1회 생성 → documents.content + metadata 저장 → 질문 표현 표준화 → 벡터·FTS·부분일치 검색 → 제목/섹션/문서 신뢰도 재정렬 → Responses API 답변`

질문 검색은 단순 문자열 일치에만 의존하지 않습니다. `연차·월차·휴가` 같은 동의어와
`할아버지가 돌아가셨어요 → 조부모 사망 경조사`, `아들이 결혼해요 → 자녀 결혼 경조사`처럼
관계와 사건을 함께 해석하는 업무 개념 규칙을 적용합니다. 자주 발생하는 새 표현은
`lib/rag/synonyms.ts`의 규칙과 테스트 케이스에 추가해 검색 품질을 지속적으로 고정합니다.
새 문서를 등록할 때는 GPT-4o mini를 문서당 한 번만 호출해 구어체·약칭·상황형 질문 별칭을
만들고 검색 인덱스에만 넣습니다. 별칭은 답변 근거로 모델에 전달하지 않습니다.

문서에는 담당 부서, 시행일, 검토 만료일, 공식/참고/초안 상태, 우선순위를 함께 저장합니다.
검색 결과가 비슷하면 공식·고우선순위 문서를 우대하고 만료 문서를 낮춥니다. 관리 대시보드의
단기 KPI는 2026-10-21~2026-11-15 실제 기록만 사용하며, 주간 고유 사용자 수는 산정에서 제외합니다.
문서 KPI는 재업로드 횟수가 아니라 관리자가 실제로 `검토 완료` 처리한 문서만 집계합니다.

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

## Slack에서 @raebi 또는 앱 메시지로 질문

Slackbot AI 사용량 제한과 무관하게 채널에서 `@raebi 질문`으로 호출하거나, Slack의
래미 앱을 열어 메시지 탭에서 바로 대화할 수 있습니다. Slack 앱 매니페스트의 Event
Subscriptions가 `POST /api/slack/events`로 `app_mention`과 `message.im` 이벤트를 전달하며,
서버는 3초 안에 접수합니다. 채널 답변은 같은 스레드에, 앱 DM 답변은 메시지 탭에 표시됩니다.

배포 환경에는 Slack 앱 설치 후 발급된 Bot User OAuth Token을
`SLACK_BOT_TOKEN`으로 추가하세요. 토큰에는 매니페스트의 `chat:write`,
`app_mentions:read`, `im:history` 권한을 사용합니다. `supabase/migrations/005_slack_mention_bot.sql`과
`006_slack_direct_messages.sql`을 순서대로 적용해야 중복 이벤트 방지와 호출 경로별 Slack KPI
집계가 동작합니다. `im:history`를 새로 추가한 뒤에는 Slack 앱을 워크스페이스에 다시 설치해야
새 권한이 Bot User OAuth Token에 반영됩니다.
