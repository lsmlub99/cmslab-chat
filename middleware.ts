import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, hasAdminPassword, verifySessionToken } from "@/lib/auth";
import { hasDomainRestriction, hasGoogleCredentials, readSession, USER_COOKIE } from "@/lib/google-auth";
import { isAdminEmail, usesEmailAdmin } from "@/lib/admin-access";

/**
 * 접근 제어.
 *
 * 두 겹입니다.
 *  1) 사용자 로그인 — 회사 구글 계정이어야 챗봇을 씁니다.
 *  2) 관리자 비밀번호 — 지식 문서와 지표는 관리자만 봅니다.
 *
 * 열어 두는 것: 로그인 화면과 인증 절차, 헬스체크, 워밍용 핑.
 * 이들이 막히면 로그인 자체가 불가능하거나 모니터링이 안 됩니다.
 */
const ALWAYS_OPEN = [
  "/login",
  "/admin/login",
  "/api/auth/",
  "/api/admin/login",
  "/api/admin/logout",
  "/api/admin/session",
  "/api/health/db",
  "/api/ping",
];

const ADMIN_ONLY_PREFIX = ["/admin", "/api/knowledge"];

function isOpen(pathname: string) {
  return ALWAYS_OPEN.some(path => pathname === path || pathname.startsWith(path));
}

function needsAdmin(pathname: string, method: string) {
  if (ADMIN_ONLY_PREFIX.some(path => pathname === path || pathname.startsWith(`${path}/`))) return true;
  if (pathname === "/api/logs") return true;
  if (pathname === "/api/dashboard") return true;
  if (pathname.startsWith("/api/questions")) return true;
  // 설정은 읽기 공개(챗봇 이름·인사말이 필요), 저장은 관리자만.
  if (pathname === "/api/settings" && method !== "GET") return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isOpen(pathname)) return NextResponse.next();

  /* ── 1) 사용자 로그인 ──────────────────────────────────────────────────── */
  /*
   * 구글 자격증명이 있으면 "로그인을 쓰기로 한 상태"로 보고 반드시 요구합니다.
   *
   * 여기서 hasGoogleConfig()(도메인 제한 포함)로 판단하면 안 됩니다.
   * ALLOWED_EMAIL_DOMAINS 를 빠뜨렸을 때 조건이 거짓이 되어 로그인을 건너뛰고
   * 사이트 전체가 열려 버립니다. 실수의 결과는 항상 "막힘"이어야 합니다.
   */
  // 세션은 한 번만 읽어 아래 두 단계에서 함께 씁니다.
  const user = await readSession(request.cookies.get(USER_COOKIE)?.value);

  if (hasGoogleCredentials()) {
    // 도메인 제한이 없으면 누구나 통과할 수 있으므로 아예 잠급니다.
    if (!hasDomainRestriction()) {
      const message = "ALLOWED_EMAIL_DOMAINS 가 설정되지 않아 로그인을 받을 수 없습니다.";
      return isApi
        ? NextResponse.json({ error: message, setupRequired: true }, { status: 503 })
        : NextResponse.redirect(new URL("/login?error=setup", request.url));
    }

    if (!user) {
      if (isApi) {
        return NextResponse.json({ error: "로그인이 필요합니다.", unauthenticated: true }, { status: 401 });
      }
      const login = new URL("/login", request.url);
      if (pathname !== "/") login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
  }

  /* ── 2) 관리자 ────────────────────────────────────────────────────────── */
  if (!needsAdmin(pathname, request.method)) return NextResponse.next();

  /*
   * 이메일로 관리자를 지정하는 방식이 우선입니다.
   * 권한이 신원에 붙으므로 계정을 바꾸면 권한도 함께 바뀝니다.
   * 예전 비밀번호 방식은 관리자 쿠키에 신원이 없어서, 같은 브라우저에서
   * 구글 계정만 바꿔도 관리자 권한이 남는 문제가 있었습니다.
   */
  if (usesEmailAdmin()) {
    if (isAdminEmail(user?.email)) return NextResponse.next();
    return isApi
      ? NextResponse.json({ error: "관리자 권한이 없는 계정입니다.", unauthorized: true }, { status: 403 })
      : NextResponse.redirect(new URL("/admin/login?error=forbidden", request.url));
  }

  // 비밀번호 방식(이메일 지정을 쓰지 않는 환경).
  if (!hasAdminPassword()) {
    const message = "ADMIN_EMAILS 또는 ADMIN_PASSWORD 를 설정해야 관리자 기능을 쓸 수 있습니다.";
    return isApi
      ? NextResponse.json({ error: message, setupRequired: true }, { status: 503 })
      : NextResponse.redirect(new URL("/admin/login?setup=1", request.url));
  }

  /*
   * 비밀번호 방식에서도 관리자 세션을 로그인한 사람과 묶습니다.
   * 계정이 바뀌면 관리자 권한도 끊어집니다.
   */
  if (await verifySessionToken(request.cookies.get(ADMIN_COOKIE)?.value, Date.now(), user?.id)) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ error: "관리자 로그인이 필요합니다.", unauthorized: true }, { status: 401 });
  }

  const login = new URL("/admin/login", request.url);
  if (pathname !== "/admin") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  /*
   * 정적 파일과 이미지에는 미들웨어를 태우지 않습니다.
   * 로그인 화면이 스타일 없이 뜨는 것을 막고 불필요한 실행도 줄입니다.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
