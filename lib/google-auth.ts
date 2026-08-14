/**
 * 구글 계정 로그인.
 *
 * 왜 직접 구현했나: 이미 관리자 인증에서 HMAC 서명 세션(lib/auth.ts)을 쓰고 있어
 * 같은 방식을 재사용하면 의존성을 늘리지 않고 동작을 전부 눈으로 확인할 수 있습니다.
 * 사내 도구 규모에서는 인증 라이브러리의 버전 변화를 따라가는 비용이 더 큽니다.
 *
 * 보안상 지키는 것:
 *  - state 파라미터를 서명해 CSRF 를 막습니다(위조된 콜백 거부).
 *  - 회사 도메인 검사를 id_token 의 hd 클레임과 이메일 양쪽에서 합니다.
 *  - 세션 쿠키는 httpOnly + 서명이라 브라우저에서 위조할 수 없습니다.
 */

export const USER_COOKIE = "answerbot_session";
const STATE_COOKIE = "answerbot_oauth_state";

/** 세션 유효 기간(30일). 사내 도구라 자주 로그인하게 만들 이유가 없습니다. */
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
/** 로그인 절차가 이 시간 안에 끝나지 않으면 state 를 무효로 봅니다. */
const STATE_MS = 10 * 60 * 1000;

export type SessionUser = {
  /** 구글 계정 고유 ID(sub). 지표의 사용자 수 기준입니다. */
  id: string;
  email: string;
  name: string;
  picture?: string;
};

export function googleClientId() {
  return process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
}

function googleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
}

/**
 * 구글 로그인을 쓰기로 한 상태인지(자격증명 존재).
 * 이 값이 참이면 미들웨어가 로그인을 요구합니다.
 */
export function hasGoogleCredentials() {
  return Boolean(googleClientId() && googleClientSecret());
}

/** 로그인을 실제로 받을 수 있는지. 도메인 제한까지 갖춰져야 합니다. */
export function hasGoogleConfig() {
  return hasGoogleCredentials() && hasDomainRestriction();
}

/** 로그인을 허용할 이메일 도메인 목록. */
export function allowedDomains() {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? "")
    .split(",")
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * 도메인 제한이 설정되어 있는지.
 *
 * 설정을 빠뜨리면 로그인 자체를 막습니다.
 * 예전에는 비어 있으면 "제한 없음"으로 통과시켰는데, 환경변수 하나를 빠뜨리는 순간
 * 아무 구글 계정으로나 사내 지식을 볼 수 있게 됩니다. 실제로 배포 후 이 변수를
 * 빠뜨린 상태가 발견됐습니다. 실수의 결과가 "전체 공개"가 되어서는 안 되므로
 * 막히는 쪽으로 뒤집었습니다.
 */
export function hasDomainRestriction() {
  return allowedDomains().length > 0;
}

export function isAllowedEmail(email: string, hostedDomain?: string) {
  const domains = allowedDomains();
  // 설정이 없으면 아무도 통과시키지 않습니다(열어 두는 쪽이 훨씬 위험합니다).
  if (!domains.length) return false;

  const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";
  // hd(hosted domain)는 구글 워크스페이스 계정에만 붙습니다.
  // 개인 gmail 이 회사 도메인처럼 보이는 별칭을 쓰는 경우를 막기 위해 둘 다 봅니다.
  if (hostedDomain && !domains.includes(hostedDomain.toLowerCase())) return false;
  return domains.includes(emailDomain);
}

function secret() {
  return (
    process.env.AUTH_SESSION_SECRET?.trim() ||
    process.env.ADMIN_SESSION_SECRET?.trim() ||
    `answerbot-user:${googleClientSecret()}`
  );
}

async function sign(message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64Url(new Uint8Array(signature));
}

/* ── 세션 ────────────────────────────────────────────────────────────────── */

export async function createSession(user: SessionUser, now = Date.now()) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ ...user, exp: now + SESSION_MS })));
  return `${payload}.${await sign(payload)}`;
}

export async function readSession(token: string | undefined, now = Date.now()): Promise<SessionUser | null> {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!timingSafeEqual(signature, await sign(payload))) return null;

  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (typeof data.exp !== "number" || data.exp < now) return null;
    if (!data.id || !data.email) return null;
    // 세션 발급 후 허용 도메인 설정이 바뀌었을 수 있으므로 다시 확인합니다.
    if (!isAllowedEmail(String(data.email))) return null;
    return { id: String(data.id), email: String(data.email), name: String(data.name ?? ""), picture: data.picture };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, secure: boolean) {
  return cookie(USER_COOKIE, token, secure, Math.floor(SESSION_MS / 1000));
}

export function clearedSessionCookie(secure: boolean) {
  return cookie(USER_COOKIE, "", secure, 0);
}

export function readSessionCookie(request: Request) {
  return readCookie(request, USER_COOKIE);
}

/* ── OAuth 절차 ──────────────────────────────────────────────────────────── */

/** 로그인 시작 시 만드는 서명된 state. 콜백이 우리가 시작한 것인지 확인합니다. */
export async function createState(returnTo: string, now = Date.now()) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ returnTo, exp: now + STATE_MS })));
  return `${payload}.${await sign(payload)}`;
}

export async function readState(token: string | undefined, now = Date.now()) {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = token.slice(0, separator);
  if (!timingSafeEqual(token.slice(separator + 1), await sign(payload))) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (typeof data.exp !== "number" || data.exp < now) return null;
    // 외부 사이트로 튕기지 않도록 앱 내부 경로만 허용합니다.
    const returnTo = typeof data.returnTo === "string" && data.returnTo.startsWith("/") && !data.returnTo.startsWith("//")
      ? data.returnTo
      : "/";
    return { returnTo };
  } catch {
    return null;
  }
}

export function stateCookie(token: string, secure: boolean) {
  return cookie(STATE_COOKIE, token, secure, Math.floor(STATE_MS / 1000));
}

export function clearedStateCookie(secure: boolean) {
  return cookie(STATE_COOKIE, "", secure, 0);
}

export function readStateCookie(request: Request) {
  return readCookie(request, STATE_COOKIE);
}

export function authorizeUrl(redirectUri: string, state: string) {
  const params = new URLSearchParams({
    client_id: googleClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    // 계정 선택 화면을 띄워 여러 계정을 쓰는 사람이 회사 계정을 고를 수 있게 합니다.
    prompt: "select_account",
  });
  const domains = allowedDomains();
  // hd 를 주면 구글 로그인 화면에서 해당 도메인 계정만 보여 줍니다(편의 기능일 뿐,
  // 실제 차단은 서버에서 다시 검사합니다).
  if (domains.length === 1) params.set("hd", domains[0]);
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/**
 * 인가 코드를 사용자 정보로 바꿉니다.
 *
 * id_token 은 구글의 토큰 엔드포인트에서 TLS 로 직접 받은 것이므로
 * 서명 검증을 생략해도 됩니다(OpenID Connect Core 3.1.3.7 및 구글 문서).
 * 브라우저를 거쳐 온 토큰이라면 반드시 서명을 검증해야 합니다.
 */
export async function exchangeCode(code: string, redirectUri: string): Promise<SessionUser | null> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: googleClientId(),
      client_secret: googleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) return null;

  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) return null;

  const claims = decodeJwtPayload(tokens.id_token);
  if (!claims?.sub || !claims.email) return null;
  if (claims.email_verified === false) return null;
  if (!isAllowedEmail(String(claims.email), claims.hd ? String(claims.hd) : undefined)) return null;

  return {
    id: String(claims.sub),
    email: String(claims.email),
    name: String(claims.name || String(claims.email).split("@")[0]),
    picture: claims.picture ? String(claims.picture) : undefined,
  };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
  } catch {
    return null;
  }
}

/* ── 공통 ────────────────────────────────────────────────────────────────── */

function cookie(name: string, value: string, secure: boolean, maxAge: number) {
  const parts = [`${name}=${value}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function readCookie(request: Request, name: string) {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1];
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
