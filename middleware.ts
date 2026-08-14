import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, hasAdminPassword, verifySessionToken } from "@/lib/auth";
import { hasGoogleConfig, readSession, USER_COOKIE } from "@/lib/google-auth";

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
  // 구글 설정이 없으면 로그인을 요구할 수 없습니다(설정 전에는 열어 둡니다).
  if (hasGoogleConfig()) {
    const user = await readSession(request.cookies.get(USER_COOKIE)?.value);
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

  // 비밀번호를 정하지 않았으면 잠긴 상태로 둡니다(열어 두는 쪽이 더 위험합니다).
  if (!hasAdminPassword()) {
    const message = ".env.local에 ADMIN_PASSWORD를 설정해야 관리자 기능을 쓸 수 있습니다.";
    return isApi
      ? NextResponse.json({ error: message, setupRequired: true }, { status: 503 })
      : NextResponse.redirect(new URL("/admin/login?setup=1", request.url));
  }

  if (await verifySessionToken(request.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.next();

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
