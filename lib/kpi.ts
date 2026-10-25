export const KPI_CAMPAIGN = {
  name: "Slack 사내지식봇 누적 운영 현황",
  from: "2026-08-25T00:00:00+09:00",
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

