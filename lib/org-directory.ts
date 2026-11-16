import "server-only";

import { database } from "@/lib/database";
import {
  formatOrgHeadcountAnswer,
  isOrgHeadcountQuestion,
  type OrgDirectorySnapshot,
} from "@/lib/org-directory-model";
import type { HistoryTurn } from "@/lib/rag/conversation-context";

export async function answerOrgDirectoryQuestion(question: string, history: HistoryTurn[] = []) {
  const previousAnswer = history.at(-1)?.answer ?? "";
  if (!isOrgHeadcountQuestion(question, previousAnswer)) return null;

  const sql = database();
  const snapshots = await sql`
    select id, snapshot_at, total_active
    from public.org_directory_snapshots
    order by snapshot_at desc
    limit 1
  `;
  if (!snapshots.length) return null;

  const snapshot = snapshots[0];
  const counts = await sql`
    select org_unit_path, active_count
    from public.org_directory_counts
    where snapshot_id = ${snapshot.id}
    order by org_unit_path
  `;
  const model: OrgDirectorySnapshot = {
    snapshotAt: new Date(snapshot.snapshot_at).toISOString(),
    totalActive: Number(snapshot.total_active),
    orgUnits: counts.map(row => ({ path: String(row.org_unit_path), count: Number(row.active_count) })),
  };
  return {
    answer: formatOrgHeadcountAnswer(question, model),
    category: "조직도·현원",
  };
}
