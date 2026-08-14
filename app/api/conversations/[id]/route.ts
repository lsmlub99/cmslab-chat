import { NextResponse } from "next/server";
import { hasDatabaseConfig } from "@/lib/database";
import { deleteConversation, listTurns, readUserCookie } from "@/lib/conversations";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

type Context = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: Context) {
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ error: ".env.local에 DATABASE_URL을 입력해 주세요." }, { status: 503 });
  }

  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "잘못된 대화 번호입니다." }, { status: 400 });

  const userId = readUserCookie(request);
  if (!userId) return NextResponse.json({ error: "대화를 찾지 못했습니다." }, { status: 404 });

  try {
    const turns = await listTurns(id, userId);
    if (!turns.length) return NextResponse.json({ error: "대화를 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ id, turns });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "대화를 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request, context: Context) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "잘못된 대화 번호입니다." }, { status: 400 });

  const userId = readUserCookie(request);
  if (!userId) return NextResponse.json({ error: "대화를 찾지 못했습니다." }, { status: 404 });

  try {
    const removed = await deleteConversation(id, userId);
    if (!removed) return NextResponse.json({ error: "대화를 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "대화를 삭제하지 못했습니다." },
      { status: 400 },
    );
  }
}
