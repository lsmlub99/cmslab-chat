import type { KnowledgeAnswerResult } from "@/lib/rag/answer-service";

const MAX_MESSAGE_CHARS = 3_800;

export function formatSlackAnswer(answer: KnowledgeAnswerResult) {
  const citations = answer.citations.slice(0, 5).map((citation, index) => {
    const title = escapeSlackText(citation.title);
    const page = citation.page ? ` (${citation.page}쪽)` : "";
    const url = safeHttpUrl(citation.sourceUrl);
    return `${index + 1}. ${url ? `<${url}|${title}>` : title}${page}`;
  });
  const citationUrls = new Set(answer.citations.map(citation => safeHttpUrl(citation.sourceUrl)).filter(Boolean));
  const seenLinks = new Set<string>();
  const links = answer.links.flatMap(link => {
    const url = safeHttpUrl(link.url);
    if (!url || citationUrls.has(url) || seenLinks.has(url)) return [];
    seenLinks.add(url);
    return [`${seenLinks.size}. <${url}|${escapeSlackText(link.title || "관련 문서")}>`];
  }).slice(0, 5);
  const sections = [
    citations.length ? `*근거 문서*\n${citations.join("\n")}` : "",
    links.length ? `*관련 링크*\n${links.join("\n")}` : "",
  ].filter(Boolean);
  const suffix = sections.length ? `\n\n${sections.join("\n\n")}` : "";
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
