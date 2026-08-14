import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, hasAdminPassword, verifySessionToken } from "@/lib/auth";

/**
 * 관리자 영역 보호.
 *
 * 무엇을 잠그고 무엇을 여는지:
 *  - 잠금: /admin 화면, 지식 문서 CRUD, 대화 기록 전문, 설정 저장, 미답변 질문 답변 등록
 *  - 공개: 채팅 화면과 그 화면이 쓰는 것들
 *      · /api/chat, /api/feedback, /api/conversations (본인 쿠키 기준으로만 조회됨)
 *      · /api/settings GET  — 챗봇 이름·인사말이 필요합니다
 *      · /api/dashboard     — 집계 숫자만 있고 대화 내용은 없습니다
 *      · /api/questions/unanswered — 채팅 화면의 "최근 미답변 질문" 카드에 씁니다
 */
const PROTECTED_PAGES = ["/admin"];
const PUBLIC_PAGES = ["/admin/login"];

function needsAuth(pathname: string, method: string) {
  if (PUBLIC_PAGES.some(path => pathname === path || pathname.startsWith(`${path}/`))) return false;
  if (PROTECTED_PAGES.some(path => pathname === path || pathname.startsWith(`${path}/`))) return true;

  // 로그인/로그아웃/세션 확인은 열려 있어야 합니다.
  if (pathname.startsWith("/api/admin/")) return false;

  if (pathname.startsWith("/api/knowledge")) return true;
  if (pathname === "/api/logs") return true;
  // 미답변 목록 조회는 공개, 답변 등록은 관리자만.
  if (pathname.startsWith("/api/questions/") && pathname.endsWith("/answer")) return true;
  // 설정은 읽기 공개, 저장은 관리자만.
  if (pathname === "/api/settings" && method !== "GET") return true;

  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;
  if (!needsAuth(pathname, method)) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");

  // 비밀번호를 아직 정하지 않았으면 잠긴 상태로 둡니다(열어 두는 쪽이 더 위험합니다).
  if (!hasAdminPassword()) {
    const message = ".env.local에 ADMIN_PASSWORD를 설정해야 관리자 기능을 쓸 수 있습니다.";
    return isApi
      ? NextResponse.json({ error: message, setupRequired: true }, { status: 503 })
      : NextResponse.redirect(new URL("/admin/login?setup=1", request.url));
  }

  if (await verifySessionToken(request.cookies.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (isApi) {
    return NextResponse.json({ error: "관리자 로그인이 필요합니다.", unauthorized: true }, { status: 401 });
  }

  const login = new URL("/admin/login", request.url);
  // 로그인 후 원래 보려던 화면으로 되돌려 보냅니다.
  if (pathname !== "/admin") login.searchParams.set("next", pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/admin/:path*", "/api/knowledge/:path*", "/api/logs", "/api/settings", "/api/questions/:path*"],
};
