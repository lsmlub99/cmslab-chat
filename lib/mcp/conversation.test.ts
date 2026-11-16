import { describe, expect, it } from "vitest";
import { mcpConversationIdentity } from "./conversation";

describe("mcpConversationIdentity", () => {
  it("returns a stable personal conversation for the same Slack user", () => {
    const identity = { userId: "U123", teamId: "T1", enterpriseId: null };
    expect(mcpConversationIdentity(identity)).toEqual(mcpConversationIdentity(identity));
  });

  it("separates different users and workspaces", () => {
    const first = mcpConversationIdentity({ userId: "U123", teamId: "T1", enterpriseId: null });
    const otherUser = mcpConversationIdentity({ userId: "U999", teamId: "T1", enterpriseId: null });
    const otherWorkspace = mcpConversationIdentity({ userId: "U123", teamId: "T2", enterpriseId: null });
    expect(first.conversationId).not.toBe(otherUser.conversationId);
    expect(first.conversationId).not.toBe(otherWorkspace.conversationId);
  });
});
