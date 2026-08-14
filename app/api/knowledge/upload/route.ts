import { NextResponse } from "next/server";
import { ingestKnowledge } from "@/lib/rag/ingest";

export const runtime = "nodejs";
// Vercel 무료(Hobby) 플랜의 함수 실행 상한이 60초입니다. Pro 라면 300까지 올릴 수 있습니다.
export const maxDuration = 60;

const ALLOWED = new Set(["pdf", "docx", "txt", "md"]);
const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일을 선택해 주세요." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "빈 파일입니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "파일은 20MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }

    const extension = file.name.toLowerCase().split(".").pop() || "";
    if (!ALLOWED.has(extension)) {
      return NextResponse.json({ error: "PDF, DOCX, TXT, MD만 지원합니다." }, { status: 400 });
    }

    const result = await ingestKnowledge({
      title: text(form.get("title")) || file.name,
      category: text(form.get("category")) || "일반",
      filename: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
      sourceLabel: text(form.get("sourceLabel")) || undefined,
      sourceUrl: text(form.get("sourceUrl")) || undefined,
      // 일괄 적재 스크립트가 기존 문서를 갱신할 때 씁니다.
      replace: text(form.get("replace")) === "true",
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "파일을 처리하지 못했습니다." },
      { status: 400 },
    );
  }
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}
