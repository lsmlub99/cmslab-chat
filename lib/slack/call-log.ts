import "server-only";

import { database } from "@/lib/database";

export type SlackBotCallStatus =
  | "processing"
  | "succeeded"
  | "insufficient"
  | "blocked"
  | "rate_limited"
  | "failed";

export async function beginSlackBotCall(input: {
  eventId: string;
  teamId: string | null;
  enterpriseId: string | null;
  userId: string;
  channelId: string;
}) {
  const inserted = await database()`
    insert into public.slack_bot_calls
      (event_id, slack_team_id, slack_enterprise_id, slack_user_id, slack_channel_id, status)
    values
      (${input.eventId}, ${input.teamId}, ${input.enterpriseId}, ${input.userId}, ${input.channelId}, 'processing')
    on conflict (event_id) do nothing
    returning id
  `;

  return inserted.length
    ? { id: Number(inserted[0].id), duplicate: false as const }
    : { id: null, duplicate: true as const };
}

export async function finishSlackBotCall(input: {
  id: number;
  status: Exclude<SlackBotCallStatus, "processing">;
  latencyMs: number;
  chatLogId?: number | null;
  errorCode?: string | null;
}) {
  await database()`
    update public.slack_bot_calls
       set status = ${input.status},
           latency_ms = ${Math.max(0, Math.round(input.latencyMs))},
           chat_log_id = ${input.chatLogId ?? null},
           error_code = ${input.errorCode ?? null},
           completed_at = now()
     where id = ${input.id}
  `;
}
