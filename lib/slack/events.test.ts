import { describe, expect, it } from "vitest";
import { parseSlackEnvelope, stripBotMention } from "./events";

describe("parseSlackEnvelope", () => {
  it("parses a human app mention and removes the bot mention", () => {
    expect(parseSlackEnvelope({
      type: "event_callback",
      event_id: "Ev123",
      team_id: "T123",
      event: {
        type: "app_mention",
        user: "U123",
        channel: "C123",
        ts: "123.456",
        text: "<@B123>  복리후생 제도 알려줘",
      },
    })).toEqual({
      kind: "mention",
      mention: {
        eventId: "Ev123",
        teamId: "T123",
        enterpriseId: null,
        userId: "U123",
        channelId: "C123",
        eventTs: "123.456",
        threadTs: null,
        question: "복리후생 제도 알려줘",
      },
    });
  });

  it("ignores bot-generated mentions to prevent loops", () => {
    expect(parseSlackEnvelope({
      type: "event_callback",
      event_id: "Ev123",
      event: { type: "app_mention", bot_id: "B999" },
    })).toEqual({ kind: "ignored" });
  });

  it("accepts Slack URL verification challenges", () => {
    expect(parseSlackEnvelope({ type: "url_verification", challenge: "challenge-value" }))
      .toEqual({ kind: "challenge", challenge: "challenge-value" });
  });
});

describe("stripBotMention", () => {
  it("removes repeated mention tokens and normalizes whitespace", () => {
    expect(stripBotMention("<@A1> 안녕\n <@B2> 질문이야"))
      .toBe("안녕 질문이야");
  });
});
