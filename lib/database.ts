import postgres, { type Sql } from "postgres";

let client: Sql | undefined;

export function hasDatabaseConfig() {
  return Boolean(connectionString());
}

export function database() {
  const url = connectionString();
  if (!url) throw new Error(".env.local의 DATABASE_URL에 Supabase 비밀번호를 입력해 주세요.");

  /*
   * 서버리스(Vercel)에서는 요청이 몰리면 인스턴스가 여러 개 뜨고, 각자 커넥션을 엽니다.
   * 인스턴스당 커넥션을 크게 잡으면 Supabase 풀러 상한을 넘길 수 있습니다.
   *
   * 다만 1개로 조이면 반대 문제가 생깁니다. 한 요청이 쿼리를 병렬로 던져도
   * 커넥션이 하나뿐이라 전부 순차 실행됩니다. 대시보드(쿼리 6개)가 계속 2초 걸리던
   * 원인이 이것이었습니다. 트랜잭션 풀러(6543)는 쿼리 단위로 커넥션을 돌려쓰므로
   * 인스턴스당 3개 정도는 안전하면서 병렬성도 살릴 수 있습니다.
   */
  const serverless = Boolean(process.env.VERCEL);

  client ??= postgres(url, {
    max: serverless ? 3 : 5,
    idle_timeout: serverless ? 20 : 20,
    connect_timeout: 15,
    ssl: "require",
    // Supabase 풀러(pgbouncer) 뒤에서는 prepared statement 를 세션 간에 재사용할 수 없습니다.
    prepare: false,
    transform: { undefined: null },
  });
  return client;
}

/**
 * DATABASE_URL을 정규화합니다.
 *  - Supabase 콘솔에서 복사한 [YOUR_PASSWORD] 자리표시자는 미설정으로 취급합니다.
 *  - 비밀번호를 대괄호로 감싼 형태([비밀번호])는 벗겨 냅니다.
 *  - `@`, `#`, `!` 같은 문자는 URL 인코딩해야 호스트 파싱이 깨지지 않습니다.
 */
function connectionString() {
  const configured = process.env.DATABASE_URL?.trim();
  if (!configured) return "";
  if (/\[?YOUR[-_]PASSWORD\]?/i.test(configured)) return "";

  const match = configured.match(/^postgres(?:ql)?:\/\/([^:@/]+):(.+)@([^@]+)$/);
  if (!match) return configured;

  const [, user, rawPassword, host] = match;
  const unwrapped = rawPassword.startsWith("[") && rawPassword.endsWith("]")
    ? rawPassword.slice(1, -1)
    : rawPassword;
  if (!unwrapped) return "";

  // 이미 인코딩된 비밀번호를 두 번 인코딩하지 않도록 먼저 디코드해 봅니다.
  const decoded = /%[0-9a-f]{2}/i.test(unwrapped) ? safeDecode(unwrapped) : unwrapped;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(decoded)}@${host}`;
}

function safeDecode(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
