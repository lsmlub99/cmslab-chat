import { NextResponse } from "next/server";
import { listDocumentGroups } from "@/lib/existing-db";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() { try { return NextResponse.json(await listDocumentGroups()); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "지식을 불러오지 못했습니다." }, { status: 503 }); } }
