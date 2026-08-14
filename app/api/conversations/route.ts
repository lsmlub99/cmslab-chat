import { NextResponse } from "next/server";
import { hasDatabaseConfig } from "@/lib/database";
import { currentUserId, listConversations } from "@/lib/conversations";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

/** 이 브라우저(쿠키 기준)의 대화 목록. */
export async function GET(request: Request) {
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ error: ".env.local에 DATABASE_URL을 입력해 주세요." }, { status: 503 });
  }

  // 아직 질문한 적이 없으면 쿠키가 없습니다. 오류가 아니라 빈 목록입니다.
  const userId = await currentUserId(request);
  if (!userId) return NextResponse.json([]);

  try {
    return NextResponse.json(await listConversations(userId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "대화 목록을 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}
