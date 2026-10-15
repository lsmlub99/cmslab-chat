import type { KnowledgeAnswerResult } from "@/lib/rag/answer-service";

const MAX_MESSAGE_CHARS = 3_800;

export function formatSlackAnswer(answer: KnowledgeAnswerResult) {
  const citations = answer.citations.slice(0, 5).map((citation, index) => {
    const title = escapeSlackText(citation.title);
    const page = citation.page ? ` (${citation.page}쪽)` : "";
    const url = safeHttpUrl(citation.sourceUrl);
    return `${index + 1}. ${url ? `<${url}|${title}>` : title}${page}`;
  });
  const suffix = citations.length ? `\n\n*근거*\n${citations.join("\n")}` : "";
  const answerBudget = Math.max(200, MAX_MESSAGE_CHARS - suffix.length);
  const body = answer.answer.length > answerBudget
    ? `${answer.answer.slice(0, answerBudget - 1)}…`
    : answer.answer;
  return `${body}${suffix}`.slice(0, MAX_MESSAGE_CHARS);
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeSlackText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\|/g, "-");
}
