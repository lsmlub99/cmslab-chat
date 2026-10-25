import "server-only";

import { NextResponse } from "next/server";
import { database, hasDatabaseConfig } from "@/lib/database";
import { KPI_CAMPAIGN, kpiProgress } from "@/lib/kpi";

const TIME_ZONE = "Asia/Seoul";

type JsonRow = Record<string, unknown>;

/** 대시보드에 필요한 모든 집계를 한 번의 DB 왕복으로 가져옵니다. */
export async function dashboardSnapshot(request: Request) {
  if (!hasDatabaseConfig()) {
    return NextResponse.json({ error: "데이터베이스 연결 설정이 필요합니다." }, { status: 503 });
  }

  try {
    const url = new URL(request.url);
    const days = clampDays(url.searchParams.get("days"));
    const to = parseDate(url.searchParams.get("to")) ?? new Date();
    const from = parseDate(url.searchParams.get("from")) ?? new Date(to.getTime() - (days - 1) * 86_400_000);
    const campaignFrom = new Date(KPI_CAMPAIGN.from);
    const campaignTo = new Date();
    const sql = database();

    const rows = await sql`
      with range_chat as (
        select count(*)::int as questions,
               count(*) filter (where is_followup)::int as followups,
               count(*) filter (where not coalesce(is_fallback, false))::int as answered,
               count(*) filter (where coalesce(is_fallback, false))::int as unanswered,
               count(distinct user_id) filter (where user_email is not null)::int as users,
               count(distinct user_id) filter (where user_id not like 'slack:%')::int as visitors,
               count(*) filter (where user_email is null and user_id not like 'slack:%')::int as anonymous_questions,
               count(*) filter (where not coalesce(is_fallback, false) and coalesce(citation_count, 0) > 0)::int as with_citation,
               coalesce(avg(response_ms) filter (where not coalesce(is_fallback, false) and response_ms is not null), 0)::int as avg_response_ms,
               coalesce(avg(top_similarity) filter (where top_similarity is not null), 0)::float8 as avg_similarity
        from public.chat_logs
        where created_at >= ${from} and created_at <= ${to}
          and coalesce(category, '') <> 'blocked'
      ),
      document_stats as (
        select count(*)::int as chunks,
               count(distinct coalesce(nullif(metadata->>'source_hash', ''), 'doc:' || id::text))::int as documents,
               count(embedding)::int as embedded,
               count(*) filter (where nullif(metadata->>'source_url', '') is not null or content ~* 'https?://')::int as source_covered,
               count(*) filter (where nullif(metadata->>'section', '') is not null)::int as section_covered,
               count(*) filter (
                 where nullif(metadata->>'owner', '') is not null
                   and nullif(metadata->>'authority', '') is not null
                   and nullif(metadata->>'effective_date', '') is not null
               )::int as governance_covered,
               coalesce(sum(reuse_count), 0)::int as reuse
        from public.documents
      ),
      feedback_stats as (
        select count(*)::int as total,
               count(*) filter (where rating > 0)::int as positive
        from public.feedback
        where created_at >= ${from} and created_at <= ${to}
      ),
      mcp_stats as (
        select count(*)::int as calls,
               count(*) filter (where status = 'succeeded')::int as successful,
               count(distinct concat_ws(':', coalesce(slack_enterprise_id, ''), coalesce(slack_team_id, ''), slack_user_id))::int as users,
               coalesce(avg(latency_ms) filter (where status = 'succeeded'), 0)::int as avg_response_ms
        from public.mcp_tool_calls
        where created_at >= ${from} and created_at <= ${to}
      ),
      slack_calls as materialized (
        select 'mcp'::text as source, status, latency_ms,
               slack_enterprise_id, slack_team_id, slack_user_id, created_at
        from public.mcp_tool_calls
        union all
        select interaction_kind::text as source, status, latency_ms,
               slack_enterprise_id, slack_team_id, slack_user_id, created_at
        from public.slack_bot_calls
      ),
      slack_stats as (
        select count(*)::int as calls,
               count(*) filter (where status = 'succeeded')::int as successful,
               count(*) filter (where source = 'mention')::int as mention_calls,
               count(*) filter (where source = 'direct_message')::int as direct_message_calls,
               count(distinct concat_ws(':', coalesce(slack_enterprise_id, ''), coalesce(slack_team_id, ''), slack_user_id))::int as users,
               coalesce(avg(latency_ms) filter (where status = 'succeeded'), 0)::int as avg_response_ms
        from slack_calls
        where created_at >= ${from} and created_at <= ${to}
      ),
      campaign_chat as (
        select count(*)::int as questions,
               count(*) filter (where not coalesce(is_fallback, false))::int as answered,
               count(*) filter (where not coalesce(is_fallback, false) and coalesce(citation_count, 0) > 0)::int as with_citation
        from public.chat_logs
        where created_at >= ${campaignFrom} and created_at <= ${campaignTo}
          and coalesce(category, '') <> 'blocked'
          and interaction_source in ('slack_mcp', 'slack_mention', 'slack_dm')
      ),
      campaign_documents as (
        select count(distinct coalesce(nullif(metadata->>'source_hash', ''), 'doc:' || id::text))::int as documents
        from public.documents
        where nullif(metadata->>'reviewed_at', '') is not null
          and (metadata->>'reviewed_at')::timestamptz >= ${campaignFrom}
          and (metadata->>'reviewed_at')::timestamptz <= ${campaignTo}
      ),
      campaign_slack as (
        select count(*) filter (where status = 'succeeded')::int as successful
        from slack_calls
        where created_at >= ${campaignFrom} and created_at <= ${campaignTo}
      )
      select to_jsonb(range_chat) as range_chat,
             to_jsonb(document_stats) as documents,
             to_jsonb(feedback_stats) as feedback,
             to_jsonb(mcp_stats) as mcp,
             to_jsonb(slack_stats) as slack,
             to_jsonb(campaign_chat) as campaign_chat,
             to_jsonb(campaign_documents) as campaign_documents,
             to_jsonb(campaign_slack) as campaign_slack,
             (select count(*)::int from public.chat_logs
               where coalesce(is_fallback, false) and coalesce(category, '') <> 'blocked') as pending,
             (select count(*)::int from public.chat_logs
               where created_at >= ${from} and created_at <= ${to} and category = 'blocked') as blocked,
             (
               select coalesce(jsonb_agg(jsonb_build_object(
                 'date', to_char(day, 'YYYY-MM-DD'), 'label', to_char(day, 'FMMM/FMDD'),
                 'questions', coalesce(counted.questions, 0), 'answered', coalesce(counted.answered, 0)
               ) order by day), '[]'::jsonb)
               from generate_series(
                 (${from}::timestamptz at time zone ${TIME_ZONE})::date,
                 (${to}::timestamptz at time zone ${TIME_ZONE})::date,
                 interval '1 day'
               ) day
               left join (
                 select (created_at at time zone ${TIME_ZONE})::date as bucket,
                        count(*)::int as questions,
                        count(*) filter (where not coalesce(is_fallback, false))::int as answered
                 from public.chat_logs
                 where created_at >= ${from} and created_at <= ${to}
                   and coalesce(category, '') <> 'blocked'
                 group by 1
               ) counted on counted.bucket = day::date
             ) as series,
             (
               select coalesce(jsonb_agg(jsonb_build_object(
                 'category', category, 'questions', questions, 'answered', answered
               ) order by questions desc, category), '[]'::jsonb)
               from (
                 select coalesce(nullif(category, ''), '미분류') as category,
                        count(*)::int as questions,
                        count(*) filter (where not coalesce(is_fallback, false))::int as answered
                 from public.chat_logs
                 where created_at >= ${from} and created_at <= ${to}
                   and coalesce(category, '') <> 'blocked'
                 group by 1 order by questions desc, category limit 6
               ) topic_rows
             ) as topics,
             (
               select coalesce(jsonb_agg(jsonb_build_object(
                 'reason', reason, 'count', count
               ) order by count desc, reason), '[]'::jsonb)
               from (
                 select coalesce(nullif(note, ''), 'unspecified') as reason, count(*)::int as count
                 from public.feedback
                 where created_at >= ${from} and created_at <= ${to} and rating < 0
                 group by 1
               ) reason_rows
             ) as negative_reasons,
             (
               select coalesce(jsonb_agg(jsonb_build_object(
                 'name', name, 'email', email, 'questions', questions,
                 'answered', answered, 'lastAt', last_at
               ) order by questions desc, last_at desc), '[]'::jsonb)
               from (
                 select coalesce(max(user_name), '이름 없음') as name,
                        user_email as email,
                        count(*)::int as questions,
                        count(*) filter (where not coalesce(is_fallback, false))::int as answered,
                        max(created_at) as last_at
                 from public.chat_logs
                 where created_at >= ${from} and created_at <= ${to} and user_email is not null
                 group by user_email order by questions desc, last_at desc limit 50
               ) people_rows
             ) as people
      from range_chat, document_stats, feedback_stats, mcp_stats, slack_stats,
           campaign_chat, campaign_documents, campaign_slack
    `;

    const snapshot = rows[0] as JsonRow;
    const chat = objectOf(snapshot.range_chat);
    const documents = objectOf(snapshot.documents);
    const feedback = objectOf(snapshot.feedback);
    const mcp = objectOf(snapshot.mcp);
    const slack = objectOf(snapshot.slack);
    const campaignChat = objectOf(snapshot.campaign_chat);
    const campaignDocuments = objectOf(snapshot.campaign_documents);
    const campaignSlack = objectOf(snapshot.campaign_slack);
    const questions = numberOf(chat.questions);
    const answered = numberOf(chat.answered);
    const feedbackTotal = numberOf(feedback.total);
    const campaignQuestions = numberOf(campaignChat.questions);
    const campaignAnswered = numberOf(campaignChat.answered);
    const campaignWithCitation = numberOf(campaignChat.with_citation);
    const campaignSlackSuccessful = numberOf(campaignSlack.successful);
    const campaignAnsweredRate = percent(campaignAnswered, campaignQuestions);
    const campaignCitationRate = percent(campaignWithCitation, campaignAnswered);

    return NextResponse.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        questions,
        followups: numberOf(chat.followups),
        users: numberOf(chat.users),
        visitors: numberOf(chat.visitors),
        anonymousQuestions: numberOf(chat.anonymous_questions),
        answeredRate: percent(answered, questions),
        unansweredRate: percent(numberOf(chat.unanswered), questions),
        reuse: numberOf(documents.reuse),
        citationRate: percent(numberOf(chat.with_citation), answered),
        avgResponseMs: numberOf(chat.avg_response_ms),
        avgSimilarity: Number(numberOf(chat.avg_similarity).toFixed(3)),
        satisfaction: feedbackTotal ? percent(numberOf(feedback.positive), feedbackTotal) : null,
        feedbackCount: feedbackTotal,
        pending: numberOf(snapshot.pending),
        blocked: numberOf(snapshot.blocked),
        documents: numberOf(documents.documents),
        chunks: numberOf(documents.chunks),
        embedded: numberOf(documents.embedded),
        sourceCoverageRate: percent(numberOf(documents.source_covered), numberOf(documents.chunks)),
        sectionCoverageRate: percent(numberOf(documents.section_covered), numberOf(documents.chunks)),
        governanceCoverageRate: percent(numberOf(documents.governance_covered), numberOf(documents.chunks)),
        mcpCalls: numberOf(mcp.calls),
        mcpSuccessfulCalls: numberOf(mcp.successful),
        mcpUniqueUsers: numberOf(mcp.users),
        mcpSuccessRate: percent(numberOf(mcp.successful), numberOf(mcp.calls)),
        mcpAvgResponseMs: numberOf(mcp.avg_response_ms),
        slackCalls: numberOf(slack.calls),
        slackSuccessfulCalls: numberOf(slack.successful),
        slackMentionCalls: numberOf(slack.mention_calls),
        slackDirectMessageCalls: numberOf(slack.direct_message_calls),
        slackUniqueUsers: numberOf(slack.users),
        slackSuccessRate: percent(numberOf(slack.successful), numberOf(slack.calls)),
        slackAvgResponseMs: numberOf(slack.avg_response_ms),
      },
      campaign: {
        name: KPI_CAMPAIGN.name,
        from: KPI_CAMPAIGN.from,
        to: campaignTo.toISOString(),
        note: "",
        metrics: [
          metric("slack_success", "Slack 정상답변", campaignSlackSuccessful, KPI_CAMPAIGN.targets.slackSuccessfulCalls, "건",
            `전체 질문 ${campaignQuestions}건 · 미답변 ${Math.max(0, campaignQuestions - campaignAnswered)}건`),
          metric("answer_rate", "답변 완료율", campaignAnsweredRate, KPI_CAMPAIGN.targets.answeredRate, "%",
            `정상답변 ${campaignAnswered}건 ÷ 전체 질문 ${campaignQuestions}건`),
          metric("citation_rate", "출처 포함률", campaignCitationRate, KPI_CAMPAIGN.targets.citationRate, "%",
            `출처 포함 ${campaignWithCitation}건 ÷ 정상답변 ${campaignAnswered}건`),
          metric("knowledge", "검토 완료 문서", numberOf(campaignDocuments.documents), KPI_CAMPAIGN.targets.knowledgeDocuments, "건",
            "관리자가 검토 완료로 표시한 원본 문서"),
        ],
      },
      negativeReasons: arrayOf(snapshot.negative_reasons),
      series: arrayOf(snapshot.series),
      topics: arrayOf(snapshot.topics),
      people: arrayOf(snapshot.people),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "대시보드 데이터를 불러오지 못했습니다." },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}

function metric(key: string, label: string, actual: number, target: number, unit: string, detail: string) {
  return { key, label, actual, target, unit, detail, progress: kpiProgress(actual, target) };
}

function objectOf(value: unknown): JsonRow {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRow : {};
}

function arrayOf(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function numberOf(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
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
