import "server-only";

import { database } from "@/lib/database";
import { suggestTeam } from "@/lib/team-routing-model";

export const GENERIC_FALLBACK_ANSWER =
  "등록된 팀 지식에서 확인되지 않는 내용입니다. 관리자에게 질문을 전달했으니 확인 후 지식으로 등록될 예정입니다.";

export async function buildKnowledgeGapAnswer(question: string) {
  const rows = await database()`
    select c.org_unit_path
    from public.org_directory_counts c
    where c.snapshot_id = (
      select id from public.org_directory_snapshots order by snapshot_at desc limit 1
    )
  `.catch(() => []);
  const labels = rows.map(row => String(row.org_unit_path).split("/").filter(Boolean).at(-1) ?? "");
  const suggestion = suggestTeam(question, labels);
  if (!suggestion) return GENERIC_FALLBACK_ANSWER;
  return [
    "등록된 사내 지식에서 확인되지 않는 내용입니다.",
    `질문 내용상 ${suggestion.team} 관련 업무로 보여 ${suggestion.contact}에게 문의해 주세요.`,
    "이 질문은 미답변으로 기록되어 이후 지식 보강에 활용됩니다.",
  ].join(" ");
}
