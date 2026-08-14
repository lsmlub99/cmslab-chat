import { NextResponse } from "next/server";
import { textKnowledgeSchema } from "@/lib/validation";
import { ingestKnowledge } from "@/lib/rag/ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const parsed = textKnowledgeSchema.parse(await request.json());
    const result = await ingestKnowledge({
      title: parsed.title,
      category: parsed.category,
      filename: `${parsed.title}.md`,
      buffer: Buffer.from(parsed.body, "utf8"),
      sourceLabel: parsed.sourceLabel,
      sourceUrl: parsed.sourceUrl || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { message: string }[] }).issues;
    if (issues?.length) return issues[0].message;
  }
  return error instanceof Error ? error.message : "지식을 저장하지 못했습니다.";
}
