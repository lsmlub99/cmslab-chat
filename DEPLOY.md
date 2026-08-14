# Vercel 배포 안내

## 시작하기 전에 — 접근 제한 상태

현재 **채팅 화면에는 아무 잠금이 없습니다.** 배포하면 URL을 아는 사람은 누구나
사내 지식(와이파이 비밀번호, 인사·경조사 규정, 제휴 할인처 등)을 조회할 수 있습니다.

Google OAuth(회사 도메인 제한)를 붙이기 전까지는:

- **URL을 외부에 공유하지 마세요.**
- 검색엔진 색인은 이미 막아 두었습니다(`app/robots.ts`, `X-Robots-Tag` 헤더).
- Vercel Pro 플랜이라면 **Settings → Deployment Protection → Vercel Authentication**
  을 켜면 Vercel 계정으로 로그인한 사람만 접근할 수 있습니다. 임시 방어로 가장 확실합니다.

관리자(`/admin`)는 `ADMIN_PASSWORD` 로 잠겨 있습니다.

---

## 1. GitHub 저장소 만들기

```bash
git init
git add .
git commit -m "답봇 초기 커밋"
git branch -M main
git remote add origin https://github.com/<계정>/<저장소>.git
git push -u origin main
```

`.gitignore` 에 `.env*` 가 들어 있어 **API 키는 커밋되지 않습니다.**
푸시 전에 `git status` 로 `.env.local` 이 목록에 없는지 한 번만 확인해 주세요.

저장소는 **비공개(Private)** 로 만드세요. 사내 문서 템플릿과 설정이 들어 있습니다.

## 2. Vercel에 연결

1. [vercel.com/new](https://vercel.com/new) 에서 방금 만든 저장소를 선택합니다.
2. Framework 는 Next.js 로 자동 인식됩니다. 빌드 설정은 건드리지 않아도 됩니다.
3. **Environment Variables** 에 아래 값을 넣습니다(3번 항목 참고).
4. Deploy 를 누릅니다.

## 3. 환경변수

Vercel → Settings → Environment Variables 에 등록합니다.
Production / Preview / Development 모두 체크하세요.

| 이름 | 값 | 비고 |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres.oqhvqcwhwqrlhvyvyfnb:<비밀번호>@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres` | **포트 6543** (아래 설명) |
| `OPENAI_API_KEY` | `sk-proj-...` | 로컬 `.env.local` 과 동일 |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | |
| `OPENAI_EMBEDDING_MODEL` | `text-embedding-3-small` | 1536차원 고정 |
| `ADMIN_PASSWORD` | (새 비밀번호) | **로컬과 다른 값을 쓰세요** |
| `ADMIN_SESSION_SECRET` | 임의의 긴 문자열 | 선택. 없으면 비밀번호에서 파생 |
| `RAG_SIMILARITY_THRESHOLD` | `0.24` | |
| `RAG_TOP_MATCH_THRESHOLD` | `0.25` | |
| `RAG_MATCH_COUNT` | `6` | |
| `RAG_CANDIDATE_COUNT` | `40` | |
| `RAG_CONTEXT_CHARS` | `12000` | |
| `RATE_LIMIT_CHAT` | `12` | 1분당 질문 수 |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | |
| `NEXT_PUBLIC_APP_NAME` | `답봇` | |

### 포트를 6543으로 바꾸는 이유

로컬에서는 **5432(세션 풀러)** 를 씁니다. 그런데 Vercel 은 요청이 몰리면 함수 인스턴스를
여러 개 띄우고 각자 커넥션을 엽니다. 세션 풀러는 커넥션을 오래 붙잡고 있어서
금방 상한에 걸리고 `remaining connection slots are reserved` 오류가 납니다.

**6543(트랜잭션 풀러)** 은 쿼리 단위로 커넥션을 돌려쓰기 때문에 서버리스에 적합합니다.
Supabase 콘솔 → Project Settings → Database → Connection string → **Transaction pooler**
에서 정확한 주소를 복사할 수 있습니다.

코드 쪽은 이미 대응돼 있습니다(`lib/database.ts` 가 Vercel 에서는 인스턴스당 커넥션 1개만
쓰고, prepared statement 를 끕니다).

## 4. 배포 후 확인

```
https://<배포주소>/api/health/db
```

이런 응답이 나와야 정상입니다.

```json
{
  "ok": true,
  "migrationsApplied": true,
  "documents": { "chunks": 36, "embedded": 36, "documents": 7 }
}
```

- `ok: false` 이고 커넥션 오류 → `DATABASE_URL` 포트가 6543인지 확인
- `migrationsApplied: false` → `supabase/migrations` 의 SQL을 Supabase SQL Editor에서 실행
- `openai: false` → `OPENAI_API_KEY` 미등록

그다음 `/admin/login` 에서 관리자 로그인이 되는지 확인하세요.

## 5. 알아 둘 것

**데이터베이스는 로컬과 같은 곳을 씁니다.** 배포본과 로컬이 같은 Supabase를 바라보므로,
배포본에서 지식을 지우면 로컬에서도 사라집니다. 분리하려면 Supabase 프로젝트를
하나 더 만들어 `DATABASE_URL` 을 다르게 주세요.

**함수 실행 시간 상한**은 무료(Hobby) 플랜이 60초입니다. 큰 PDF를 올리면
임베딩 생성이 60초를 넘겨 실패할 수 있습니다. 그럴 때는 문서를 나눠 올리거나
로컬에서 `npm run ingest` 로 넣으세요(로컬은 시간 제한이 없습니다).

**비용**: OpenAI 사용료는 질문 수에 비례합니다. 접근 제한이 없는 동안에는
`RATE_LIMIT_CHAT` 을 낮게 유지하시고, OpenAI 대시보드에서 월 사용 한도(usage limit)를
걸어 두시길 권합니다.
