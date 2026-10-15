export type SlackMention = {
  eventId: string;
  teamId: string | null;
  enterpriseId: string | null;
  userId: string;
  channelId: string;
  eventTs: string;
  threadTs: string | null;
  question: string;
};

export type SlackEnvelope =
  | { kind: "challenge"; challenge: string }
  | { kind: "mention"; mention: SlackMention }
  | { kind: "ignored" }
  | { kind: "invalid" };

/** Slack Events API payload에서 실제 사람의 @mention만 꺼냅니다. */
export function parseSlackEnvelope(value: unknown): SlackEnvelope {
  if (!isRecord(value)) return { kind: "invalid" };

  if (value.type === "url_verification") {
    return typeof value.challenge === "string" && value.challenge.length <= 512
      ? { kind: "challenge", challenge: value.challenge }
      : { kind: "invalid" };
  }

  if (value.type !== "event_callback" || !isRecord(value.event)) return { kind: "ignored" };
  const event = value.event;
  if (event.type !== "app_mention" || typeof event.bot_id === "string" || typeof event.subtype === "string") {
    return { kind: "ignored" };
  }

  const eventId = stringValue(value.event_id);
  const userId = stringValue(event.user);
  const channelId = stringValue(event.channel);
  const eventTs = stringValue(event.ts);
  const text = stringValue(event.text);
  if (!eventId || !userId || !channelId || !eventTs || text === null) return { kind: "invalid" };

  return {
    kind: "mention",
    mention: {
      eventId,
      teamId: stringValue(value.team_id),
      enterpriseId: stringValue(value.enterprise_id),
      userId,
      channelId,
      eventTs,
      threadTs: stringValue(event.thread_ts),
      question: stripBotMention(text),
    },
  };
}

export function stripBotMention(text: string) {
  return text.replace(/<@[A-Z0-9]+>/gi, " ").replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
