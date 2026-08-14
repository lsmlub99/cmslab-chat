/**
 * 관리자 인증.
 *
 * 사내 도구라 계정 테이블까지 두지 않고 .env.local 의 비밀번호 하나로 잠급니다.
 * 로그인에 성공하면 서명된 세션 토큰을 httpOnly 쿠키로 내려 줍니다.
 *
 * 서명은 Web Crypto(HMAC-SHA256)로 합니다. node:crypto 를 쓰면 Edge 런타임에서 도는
 * middleware.ts 에서 못 불러오기 때문입니다.
 */

export const ADMIN_COOKIE = "answerbot_admin";

/** 세션 유효 시간(12시간). */
const SESSION_MS = 12 * 60 * 60 * 1000;

export function adminPassword() {
  return process.env.ADMIN_PASSWORD?.trim() ?? "";
}

export function hasAdminPassword() {
  return adminPassword().length > 0;
}

/**
 * 서명 키. ADMIN_SESSION_SECRET 이 없으면 비밀번호에서 파생합니다.
 * 비밀번호를 바꾸면 기존 세션이 자동으로 무효가 되는 효과도 있습니다.
 */
function secret() {
  const configured = process.env.ADMIN_SESSION_SECRET?.trim();
  return configured || `answerbot-session:${adminPassword()}`;
}

async function hmac(message: string) {
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

/**
 * 관리자 세션 토큰.
 *
 * boundUserId 를 함께 서명하면 그 사람의 세션에서만 유효합니다.
 * 예전에는 만료 시각만 서명해서, 같은 브라우저에서 구글 계정을 바꿔도
 * 관리자 권한이 그대로 남았습니다(관리자 쿠키에 신원이 없었기 때문입니다).
 */
export async function createSessionToken(now = Date.now(), boundUserId?: string) {
  const expiresAt = String(now + SESSION_MS);
  const payload = boundUserId ? `${expiresAt}:${boundUserId}` : expiresAt;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySessionToken(
  token: string | undefined,
  now = Date.now(),
  currentUserId?: string,
) {
  if (!token || !hasAdminPassword()) return false;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!timingSafeEqual(signature, await hmac(payload))) return false;

  const [expiresAt, boundUserId] = payload.split(":");
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < now) return false;

  // 로그인한 사람이 바뀌었으면 관리자 권한도 끊습니다.
  if (boundUserId && boundUserId !== currentUserId) return false;
  // 로그인 사용자가 있는데 토큰이 그 사람과 묶여 있지 않으면(구글 로그인 도입 전에
  // 발급된 토큰) 다시 로그인하게 합니다.
  if (!boundUserId && currentUserId) return false;

  return true;
}

/** 입력한 비밀번호 확인. 길이·내용이 응답 시간에 드러나지 않도록 해시를 비교합니다. */
export async function verifyPassword(input: unknown) {
  if (!hasAdminPassword() || typeof input !== "string") return false;
  const [given, expected] = await Promise.all([sha256(input), sha256(adminPassword())]);
  return timingSafeEqual(given, expected);
}

export function sessionCookie(token: string, secure: boolean) {
  const parts = [
    `${ADMIN_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearedCookie(secure: boolean) {
  const parts = [`${ADMIN_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readAdminCookie(request: Request) {
  return request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([^;]*)`))?.[1];
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

/** 길이가 같은 두 문자열을 상수 시간에 비교합니다. */
function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
