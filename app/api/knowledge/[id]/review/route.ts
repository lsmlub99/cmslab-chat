import { NextResponse } from "next/server";
import { reviewDocumentGroup } from "@/lib/existing-db";
import { logUserAction } from "@/lib/server/telemetry.server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const id = Number((await context.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 문서 번호입니다." }, { status: 400 });
  try {
    const result = await reviewDocumentGroup(id);
    await logUserAction({ action: "review_document", success: true }).catch(() => undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    await logUserAction({ action: "review_document", success: false }).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "검토 상태를 저장하지 못했습니다." }, { status: 400 });
  }
}

