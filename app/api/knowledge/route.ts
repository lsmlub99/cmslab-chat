import { NextResponse } from "next/server";
import { listDocumentGroups } from "@/lib/existing-db";

export async function GET() { try { return NextResponse.json(await listDocumentGroups()); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "지식을 불러오지 못했습니다." }, { status: 503 }); } }
