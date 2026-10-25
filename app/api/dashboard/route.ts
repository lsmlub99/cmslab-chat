import { NextResponse } from "next/server";
import { database, hasDatabaseConfig } from "@/lib/database";
import { KPI_CAMPAIGN, kpiProgress } from "@/lib/kpi";

// Vercel Hobby 플랜의 기본 함수 실행 상한은 10초입니다.
// 콜드 스타트에 DB 연결(TLS 핸드셰이크)이 겹치면 10초를 넘겨 504가 납니다.
export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * 운영 지표. 모든 수치는 public.chat_logs / feedback / documents 실측값입니다.
 *
 * 집계를 SQL에서 하는 이유: postgres.js 는 timestamptz 를 Date 객체로 돌려줍니다.
 * 예전 코드는 created_at.slice(0, 10) 을 호출해 매번 예외가 났습니다.
 * 날짜 버킷팅도 DB의 시간대(Asia/Seoul) 기준으로 맞춰야 "오늘"이 어긋나지 않습니다.
 */
const TIME_ZONE = "Asia/Seoul";

export async function GET(request: Request) {
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ error: ".env.local에 DATABASE_URL을 입력해 주세요." }, { status: 503 });
  }

  try {
    const url = new URL(request.url);
    const days = clampDays(url.searchParams.get("days"));
    const to = parseDate(url.searchParams.get("to")) ?? new Date();
    const from = parseDate(url.searchParams.get("from")) ?? new Date(to.getTime() - (days - 1) * 86_400_000);

    const sql = database();

    const [totals, series, topics, documents] = await Promise.all([
      sql`
        select
          count(*)::int as questions,
          count(*) filter (where is_followup)::int as followups,
          count(*) filter (where not coalesce(is_fallback, false))::int as answered,
          count(*) filter (where coalesce(is_fallback, false))::int as unanswered,
          -- 로그인 도입 전 기록은 user_email 이 비어 있습니다.
          -- 그 시절 user_id 는 브라우저 쿠키라 사람 수로 셀 수 없으므로
          -- "사용자 수"는 로그인 계정만 셉니다(성과 보고에 쓰는 값이라 기준을 분명히 둡니다).
          count(distinct user_id) filter (where user_email is not null)::int as users,
          count(distinct user_id) filter (where user_id not like 'slack:%')::int as visitors,
          count(*) filter (where user_email is null and user_id not like 'slack:%')::int as anonymous_questions,
          count(*) filter (where not coalesce(is_fallback, false) and coalesce(citation_count, 0) > 0)::int as with_citation,
          coalesce(avg(response_ms) filter (where not coalesce(is_fallback, false) and response_ms is not null), 0)::int as avg_response_ms,
          coalesce(avg(top_similarity) filter (where top_similarity is not null), 0)::float8 as avg_similarity
        from public.chat_logs
        where created_at >= ${from} and created_at <= ${to}
          -- 차단된 질문은 실제 이용이 아니므로 지표에서 뺍니다.
          and coalesce(category, '') <> 'blocked'
      `,
      sql`
        select to_char(day, 'YYYY-MM-DD') as date,
               to_char(day, 'FMMM/FMDD') as label,
               coalesce(counted.questions, 0)::int as questions,
               coalesce(counted.answered, 0)::int as answered
        from generate_series(
               (${from}::timestamptz at time zone ${TIME_ZONE})::date,
               (${to}::timestamptz at time zone ${TIME_ZONE})::date,
               interval '1 day'
             ) as day
        left join (
          select (created_at at time zone ${TIME_ZONE})::date as bucket,
                 count(*) as questions,
                 count(*) filter (where not coalesce(is_fallback, false)) as answered
           from public.chat_logs
           where created_at >= ${from} and created_at <= ${to}
             and coalesce(category, '') <> 'blocked'
           group by 1
        ) as counted on counted.bucket = day::date
        order by day
      `,
      sql`
        select coalesce(nullif(category, ''), '미분류') as category,
               count(*)::int as questions,
               count(*) filter (where not coalesce(is_fallback, false))::int as answered
        from public.chat_logs
        where created_at >= ${from} and created_at <= ${to}
          -- 차단된 질문은 실제 이용이 아니므로 지표에서 뺍니다.
          and coalesce(category, '') <> 'blocked'
        group by 1
        order by questions desc, category
        limit 6
      `,
      sql`
        select count(*)::int as chunks,
               count(distinct coalesce(nullif(metadata->>'source_hash', ''), 'doc:' || id::text))::int as documents,
               count(embedding)::int as embedded,
               count(*) filter (
                 where nullif(metadata->>'source_url', '') is not null or content ~* 'https?://'
               )::int as source_covered,
               count(*) filter (where nullif(metadata->>'section', '') is not null)::int as section_covered,
               count(*) filter (
                 where nullif(metadata->>'owner', '') is not null
                   and nullif(metadata->>'authority', '') is not null
                   and nullif(metadata->>'effective_date', '') is not null
               )::int as governance_covered,
               coalesce(sum(reuse_count), 0)::int as reuse
        from public.documents
      `,
    ]);

    // 피드백에는 기간 컬럼이 있으나 chat_log_id 로 답변과 이어집니다.
    const feedback = await sql`
      select count(*)::int as total,
             count(*) filter (where rating > 0)::int as positive
      from public.feedback
      where created_at >= ${from} and created_at <= ${to}
    `;

    const negativeReasons = await sql`
      select coalesce(nullif(note, ''), 'unspecified') as reason, count(*)::int as count
      from public.feedback
      where created_at >= ${from} and created_at <= ${to} and rating < 0
      group by 1
      order by count desc, reason
    `;

    const pending = await sql`
      select count(*)::int as pending from public.chat_logs
      where coalesce(is_fallback, false) and coalesce(category, '') <> 'blocked'
    `;

    // 차단된 질문은 따로 셉니다. 지표에는 넣지 않되 운영자가 흐름은 알아야 합니다.
    const blocked = await sql`
      select count(*)::int as blocked
      from public.chat_logs
      where created_at >= ${from} and created_at <= ${to} and category = 'blocked'
    `;

    // 누가 얼마나 쓰는지. 성과 보고에서 "사용자 수"의 근거가 되는 목록입니다.
    const people = await sql`
      select coalesce(max(user_name), '이름 없음') as name,
             user_email as email,
             count(*)::int as questions,
             count(*) filter (where not coalesce(is_fallback, false))::int as answered,
             max(created_at) as last_at
      from public.chat_logs
      where created_at >= ${from} and created_at <= ${to} and user_email is not null
      group by user_email
      order by questions desc, last_at desc
      limit 50
    `;

    // 004_slack_mcp.sql 적용 전에도 기존 대시보드는 열리도록 MCP 집계만 0으로 물러섭니다.
    let mcp = { calls: 0, successful: 0, users: 0, avgResponseMs: 0 };
    try {
      const rows = await sql`
        select count(*)::int as calls,
               count(*) filter (where status = 'succeeded')::int as successful,
               count(distinct concat_ws(':', coalesce(slack_enterprise_id, ''), coalesce(slack_team_id, ''), slack_user_id))::int as users,
               coalesce(avg(latency_ms) filter (where status = 'succeeded'), 0)::int as avg_response_ms
        from public.mcp_tool_calls
        where created_at >= ${from} and created_at <= ${to}
      `;
      mcp = {
        calls: Number(rows[0].calls),
        successful: Number(rows[0].successful),
        users: Number(rows[0].users),
        avgResponseMs: Number(rows[0].avg_response_ms),
      };
    } catch {
      // 아직 마이그레이션을 적용하지 않은 배포를 위한 호환 경로입니다.
    }

    // Slackbot MCP, 일반 @멘션, 앱 DM을 합친 실제 Slack 이용 지표입니다.
    // 005/006 마이그레이션 전에는 기존 MCP 집계로 안전하게 물러섭니다.
    let slack = { ...mcp, mentionCalls: 0, directMessageCalls: 0 };
    try {
      const rows = await sql`
        select count(*)::int as calls,
               count(*) filter (where status = 'succeeded')::int as successful,
               count(*) filter (where source = 'mention')::int as mention_calls,
               count(*) filter (where source = 'direct_message')::int as direct_message_calls,
               count(distinct concat_ws(':', coalesce(slack_enterprise_id, ''), coalesce(slack_team_id, ''), slack_user_id))::int as users,
               coalesce(avg(latency_ms) filter (where status = 'succeeded'), 0)::int as avg_response_ms
        from (
          select 'mcp'::text as source, status, latency_ms,
                 slack_enterprise_id, slack_team_id, slack_user_id, created_at
          from public.mcp_tool_calls
          union all
          select interaction_kind::text as source, status, latency_ms,
                 slack_enterprise_id, slack_team_id, slack_user_id, created_at
          from public.slack_bot_calls
        ) as slack_calls
        where created_at >= ${from} and created_at <= ${to}
      `;
      slack = {
        calls: Number(rows[0].calls),
        successful: Number(rows[0].successful),
        mentionCalls: Number(rows[0].mention_calls),
        directMessageCalls: Number(rows[0].direct_message_calls),
        users: Number(rows[0].users),
        avgResponseMs: Number(rows[0].avg_response_ms),
      };
    } catch {
      // 아직 005/006 Slack 마이그레이션을 적용하지 않은 배포를 위한 호환 경로입니다.
    }

    // 내부 예상 질의 검증은 실사용 로그와 별도 테이블에서 읽습니다.
    // 마이그레이션 적용 전에도 기존 대시보드는 그대로 열리도록 선택 항목으로 둡니다.
    let syntheticEvaluation: {
      total: number;
      passed: number;
      failed: number;
      needsKnowledge: number;
      passRate: number;
      sourceRate: number;
      avgRetrievalMs: number;
      evaluatedAt: string | null;
      topics: { topic: string; total: number; passed: number }[];
      items: {
        key: string;
        question: string;
        topic: string;
        status: "passed" | "failed" | "needs_knowledge";
        matchedSource: string | null;
        evidencePreview: string | null;
        similarity: number | null;
        retrievalMs: number | null;
      }[];
    } | undefined;
    try {
      const [summaryRows, topicRows, itemRows] = await Promise.all([
        sql`
          select count(*)::int as total,
                 count(*) filter (where status = 'passed')::int as passed,
                 count(*) filter (where status = 'failed')::int as failed,
                 count(*) filter (where status = 'needs_knowledge')::int as needs_knowledge,
                 count(*) filter (where nullif(matched_source, '') is not null)::int as with_source,
                 coalesce(avg(retrieval_ms), 0)::int as avg_retrieval_ms,
                 max(evaluated_at) as evaluated_at
          from public.synthetic_evaluations
          where synthetic = true
        `,
        sql`
          select topic, count(*)::int as total,
                 count(*) filter (where status = 'passed')::int as passed
          from public.synthetic_evaluations
          where synthetic = true
          group by topic
          order by count(*) desc, topic
        `,
        sql`
          select scenario_key, question, topic, status, matched_source,
                 evidence_preview, similarity, retrieval_ms
          from public.synthetic_evaluations
          where synthetic = true
          order by topic, scenario_key
        `,
      ]);
      const summary = summaryRows[0];
      const total = Number(summary.total);
      syntheticEvaluation = {
        total,
        passed: Number(summary.passed),
        failed: Number(summary.failed),
        needsKnowledge: Number(summary.needs_knowledge),
        passRate: percent(Number(summary.passed), total),
        sourceRate: percent(Number(summary.with_source), total),
        avgRetrievalMs: Number(summary.avg_retrieval_ms),
        evaluatedAt: summary.evaluated_at instanceof Date
          ? summary.evaluated_at.toISOString()
          : summary.evaluated_at ? String(summary.evaluated_at) : null,
        topics: topicRows.map(row => ({
          topic: String(row.topic), total: Number(row.total), passed: Number(row.passed),
        })),
        items: itemRows.map(row => ({
          key: String(row.scenario_key),
          question: String(row.question),
          topic: String(row.topic),
          status: String(row.status) as "passed" | "failed" | "needs_knowledge",
          matchedSource: row.matched_source ? String(row.matched_source) : null,
          evidencePreview: row.evidence_preview ? String(row.evidence_preview) : null,
          similarity: row.similarity === null ? null : Number(row.similarity),
          retrievalMs: row.retrieval_ms === null ? null : Number(row.retrieval_ms),
        })),
      };
    } catch {
      // 009 마이그레이션 적용 전 호환 경로입니다.
    }

    const campaignFrom = new Date(KPI_CAMPAIGN.from);
    // 종료일에 고정하지 않고 현재 시점까지 누적해 오늘 Slack 이용도 즉시 반영합니다.
    const campaignTo = new Date();
    const [campaignChat, campaignDocuments] = await Promise.all([
      sql`
        select count(*)::int as questions,
               count(*) filter (where not coalesce(is_fallback, false))::int as answered,
               count(*) filter (where not coalesce(is_fallback, false) and coalesce(citation_count, 0) > 0)::int as with_citation
        from public.chat_logs
        where created_at >= ${campaignFrom} and created_at <= ${campaignTo}
          and coalesce(category, '') <> 'blocked'
          and interaction_source in ('slack_mcp', 'slack_mention', 'slack_dm')
      `,
      sql`
        select count(distinct coalesce(nullif(metadata->>'source_hash', ''), 'doc:' || id::text))::int as documents
        from public.documents
        where nullif(metadata->>'reviewed_at', '') is not null
          and (metadata->>'reviewed_at')::timestamptz >= ${campaignFrom}
          and (metadata->>'reviewed_at')::timestamptz <= ${campaignTo}
      `,
    ]);

    let campaignSlackSuccessful = 0;
    try {
      const rows = await sql`
        select count(*) filter (where status = 'succeeded')::int as successful
        from (
          select status, created_at from public.mcp_tool_calls
          union all
          select status, created_at from public.slack_bot_calls
        ) calls
        where created_at >= ${campaignFrom} and created_at <= ${campaignTo}
      `;
      campaignSlackSuccessful = Number(rows[0].successful);
    } catch {
      // Slack 집계 테이블이 없는 초기 배포에서는 0으로 표시합니다.
    }

    const row = totals[0];
    const questions = Number(row.questions);
    const answered = Number(row.answered);
    const totalFeedback = Number(feedback[0].total);
    const campaignQuestions = Number(campaignChat[0].questions);
    const campaignAnswered = Number(campaignChat[0].answered);
    const campaignKnowledgeDocuments = Number(campaignDocuments[0].documents);
    const campaignAnsweredRate = percent(campaignAnswered, campaignQuestions);
    const campaignCitationRate = percent(Number(campaignChat[0].with_citation), campaignAnswered);

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        questions,
        followups: Number(row.followups),
        users: Number(row.users),
        visitors: Number(row.visitors),
        anonymousQuestions: Number(row.anonymous_questions),
        answeredRate: percent(answered, questions),
        unansweredRate: percent(Number(row.unanswered), questions),
        reuse: Number(documents[0].reuse),
        citationRate: percent(Number(row.with_citation), answered),
        avgResponseMs: Number(row.avg_response_ms),
        avgSimilarity: Number(Number(row.avg_similarity).toFixed(3)),
        satisfaction: totalFeedback ? percent(Number(feedback[0].positive), totalFeedback) : null,
        feedbackCount: totalFeedback,
        pending: Number(pending[0].pending),
        blocked: Number(blocked[0].blocked),
        documents: Number(documents[0].documents),
        chunks: Number(documents[0].chunks),
        embedded: Number(documents[0].embedded),
        sourceCoverageRate: percent(Number(documents[0].source_covered), Number(documents[0].chunks)),
        sectionCoverageRate: percent(Number(documents[0].section_covered), Number(documents[0].chunks)),
        governanceCoverageRate: percent(Number(documents[0].governance_covered), Number(documents[0].chunks)),
        mcpCalls: mcp.calls,
        mcpSuccessfulCalls: mcp.successful,
        mcpUniqueUsers: mcp.users,
        mcpSuccessRate: percent(mcp.successful, mcp.calls),
        mcpAvgResponseMs: mcp.avgResponseMs,
        slackCalls: slack.calls,
        slackSuccessfulCalls: slack.successful,
        slackMentionCalls: slack.mentionCalls,
        slackDirectMessageCalls: slack.directMessageCalls,
        slackUniqueUsers: slack.users,
        slackSuccessRate: percent(slack.successful, slack.calls),
        slackAvgResponseMs: slack.avgResponseMs,
      },
      campaign: {
        name: KPI_CAMPAIGN.name,
        from: KPI_CAMPAIGN.from,
        to: campaignTo.toISOString(),
        note: "",
        metrics: [
          { key: "slack_success", label: "Slack 정상답변", actual: campaignSlackSuccessful, target: KPI_CAMPAIGN.targets.slackSuccessfulCalls, unit: "건", progress: kpiProgress(campaignSlackSuccessful, KPI_CAMPAIGN.targets.slackSuccessfulCalls) },
          { key: "answer_rate", label: "답변 완료율", actual: campaignAnsweredRate, target: KPI_CAMPAIGN.targets.answeredRate, unit: "%", progress: kpiProgress(campaignAnsweredRate, KPI_CAMPAIGN.targets.answeredRate) },
          { key: "citation_rate", label: "출처 포함률", actual: campaignCitationRate, target: KPI_CAMPAIGN.targets.citationRate, unit: "%", progress: kpiProgress(campaignCitationRate, KPI_CAMPAIGN.targets.citationRate) },
          { key: "knowledge", label: "검토 완료 문서", actual: campaignKnowledgeDocuments, target: KPI_CAMPAIGN.targets.knowledgeDocuments, unit: "건", progress: kpiProgress(campaignKnowledgeDocuments, KPI_CAMPAIGN.targets.knowledgeDocuments) },
        ],
      },
      syntheticEvaluation,
      negativeReasons: negativeReasons.map(row => ({ reason: String(row.reason), count: Number(row.count) })),
      series: series.map(item => ({
        date: String(item.date),
        label: String(item.label),
        questions: Number(item.questions),
        answered: Number(item.answered),
      })),
      topics: topics.map(item => ({
        category: String(item.category),
        questions: Number(item.questions),
        answered: Number(item.answered),
      })),
      people: people.map(item => ({
        name: String(item.name),
        email: String(item.email),
        questions: Number(item.questions),
        answered: Number(item.answered),
        lastAt: item.last_at instanceof Date ? item.last_at.toISOString() : String(item.last_at ?? ""),
      })),
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "대시보드 데이터를 불러오지 못했습니다." },
      { status: 503 },
    );
  }
}

function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function clampDays(value: string | null) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(365, Math.max(1, Math.round(parsed)));
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
