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
      kind: "message",
      message: {
        eventId: "Ev123",
        teamId: "T123",
        enterpriseId: null,
        userId: "U123",
        channelId: "C123",
        eventTs: "123.456",
        threadTs: null,
        question: "복리후생 제도 알려줘",
        interactionKind: "mention",
      },
    });
  });

  it("parses a direct message without requiring a bot mention", () => {
    expect(parseSlackEnvelope({
      type: "event_callback",
      event_id: "EvDM1",
      team_id: "T123",
      event: {
        type: "message",
        channel_type: "im",
        user: "U123",
        channel: "D123",
        ts: "124.456",
        text: "그럼 어디에서 신청해?",
      },
    })).toEqual({
      kind: "message",
      message: {
        eventId: "EvDM1",
        teamId: "T123",
        enterpriseId: null,
        userId: "U123",
        channelId: "D123",
        eventTs: "124.456",
        threadTs: null,
        question: "그럼 어디에서 신청해?",
        interactionKind: "direct_message",
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

  it("ignores bot-generated direct messages to prevent reply loops", () => {
    expect(parseSlackEnvelope({
      type: "event_callback",
      event_id: "EvDM2",
      event: {
        type: "message",
        channel_type: "im",
        bot_id: "B999",
        channel: "D123",
        ts: "125.456",
        text: "bot reply",
      },
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
