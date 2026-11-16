type SlackConversationIdentity = {
  userId: string;
  teamId: string | null;
  enterpriseId: string | null;
};

/** Slack MCP 호출을 다른 직원과 섞이지 않는 개인 대화 키로 변환합니다. */
export function mcpConversationIdentity(identity: SlackConversationIdentity) {
  const workspace = identity.enterpriseId ?? identity.teamId ?? "workspace";
  return {
    actorId: `slack:${workspace}:${identity.userId}`,
    conversationId: `slack:mcp:${workspace}:${identity.userId}`,
  };
}
