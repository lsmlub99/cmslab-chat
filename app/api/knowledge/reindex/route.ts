import { NextResponse } from "next/server";
import { reindexExistingDocuments } from "@/lib/rag/reindex";
import { logUserAction } from "@/lib/server/telemetry.server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await request.json().catch(() => ({})) as { force?: boolean };
    const result = await reindexExistingDocuments({ force: body.force === true });
    await logUserAction({
      action: "reindex_documents",
      success: true,
      latencyMs: Date.now() - started,
    }).catch(() => undefined);
    return NextResponse.json(result);
  } catch (error) {
    await logUserAction({
      action: "reindex_documents",
      success: false,
      latencyMs: Date.now() - started,
    }).catch(() => undefined);
    return NextResponse.json({ error: error instanceof Error ? error.message : "기존 지식을 재구성하지 못했습니다." }, { status: 400 });
  }
}

