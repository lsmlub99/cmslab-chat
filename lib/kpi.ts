export const KPI_CAMPAIGN = {
  name: "Slack 사내지식봇 단기 실사용 검증",
  from: "2026-10-21T00:00:00+09:00",
  to: "2026-11-15T23:59:59.999+09:00",
  targets: {
    slackSuccessfulCalls: 60,
    answeredRate: 85,
    citationRate: 80,
    knowledgeDocuments: 10,
  },
} as const;

export function kpiProgress(actual: number, target: number) {
  return target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
}

