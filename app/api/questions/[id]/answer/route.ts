import { NextResponse } from "next/server";
import { ingestKnowledge } from "@/lib/rag/ingest";
import { database } from "@/lib/database";
import { answerQuestionSchema } from "@/lib/validation";
import { logUserAction } from "@/lib/server/telemetry.server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 미답변 질문에 관리자가 답을 달면
 *  1) 그 답변을 새 지식 문서로 청킹·임베딩해 적재하고
 *  2) 원래 로그를 답변 완료로 바꿉니다.
 * 이후 같은 질문은 벡터 검색으로 바로 걸립니다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const id = Number((await context.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "잘못된 질문 번호입니다." }, { status: 400 });

    const parsed = answerQuestionSchema.parse(await request.json());
    const sql = database();

    const rows = await sql`
      select id, user_message from public.chat_logs
      where id = ${id} and coalesce(is_fallback, false) limit 1
    `;
    if (!rows.length) return NextResponse.json({ error: "미답변 질문을 찾지 못했습니다." }, { status: 404 });

    const question = String(rows[0].user_message);
    const category = parsed.category || "관리자 답변";

    // 질문과 답변을 함께 넣어야 다음에 같은 질문이 들어올 때 임베딩이 잘 걸립니다.
    const body = `질문: ${question}\n\n답변: ${parsed.answer}`;

    const saved = await ingestKnowledge({
      title: question.slice(0, 120),
      category,
      filename: `${question.slice(0, 60)}.md`,
      buffer: Buffer.from(body, "utf8"),
      sourceLabel: parsed.sourceLabel,
      sourceUrl: parsed.sourceUrl || undefined,
      replace: true,
    });

    await sql`
      update public.chat_logs
      set bot_answer = ${parsed.answer}, is_fallback = false, category = ${category}
      where id = ${id}
    `;

    // 사용 기록: 질문이나 답변 내용은 보내지 않습니다.
    await logUserAction({ action: "answer_question", success: true }).catch(() => undefined);

    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { message: string }[] }).issues;
    if (issues?.length) return issues[0].message;
  }
  return error instanceof Error ? error.message : "답변을 저장하지 못했습니다.";
}
