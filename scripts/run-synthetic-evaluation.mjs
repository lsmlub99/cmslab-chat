/**
 * 내부 예상 질의 60건을 실제 임베딩/검색 함수로 검증해 별도 테이블에 저장합니다.
 * chat_logs 및 Slack 호출 테이블에는 쓰지 않으므로 실사용 KPI에 포함되지 않습니다.
 */
import fs from "node:fs";
import OpenAI from "openai";
import postgres from "postgres";

function envValue(key) {
  if (process.env[key]) return process.env[key];
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && match[1] === key) return match[2].replace(/^"|"$/g, "").trim();
  }
  return "";
}

function databaseUrl() {
  const configured = envValue("DATABASE_URL");
  if (configured) return configured;
  const password = envValue("SUPABASE_PWD");
  if (!password) throw new Error("DATABASE_URL 또는 SUPABASE_PWD가 필요합니다.");
  return "postgresql://postgres.oqhvqcwhwqrlhvyvyfnb:"
    + encodeURIComponent(password)
    + "@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres";
}

function terms(question) {
  const stopwords = new Set(["어떻게", "알려줘", "알려주세요", "궁금해요", "있나요", "되나요", "어디서", "우리", "회사"]);
  return [...new Set(question.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean)
    .flatMap(word => {
      const stem = word.replace(/(은|는|이|가|을|를|에|에서|도|만|요)$/, "");
      return word === stem ? [word] : [word, stem];
    })
    .filter(word => word.length >= 2 && !stopwords.has(word)))].slice(0, 16);
}

const scenarios = JSON.parse(fs.readFileSync("data/synthetic-evaluation-scenarios.json", "utf8"));
if (scenarios.length !== 60) throw new Error(`예상 질의가 60건이 아닙니다: ${scenarios.length}`);

const openai = new OpenAI({ apiKey: envValue("OPENAI_API_KEY") });
const sql = postgres(databaseUrl(), { max: 5, prepare: false, ssl: "require", connect_timeout: 20 });

try {
  const embeddingResponse = await openai.embeddings.create({
    model: envValue("OPENAI_EMBEDDING_MODEL") || "text-embedding-3-small",
    input: scenarios.map(item => item.question),
  });

  const results = [];
  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    const started = Date.now();
    const vector = `[${embeddingResponse.data[index].embedding.join(",")}]`;
    const rows = await sql`
      select * from public.match_documents_answerbot(
        ${vector}::vector,
        ${scenario.question},
        ${terms(scenario.question)}::text[],
        12,
        40
      )
    `;

    const expected = scenario.expectedSource
      ? rows.find(row => String(row.metadata?.title || row.metadata?.fileName || "").includes(scenario.expectedSource))
      : null;
    // 문서가 없다고 명시한 갭 시나리오에는 우연히 가까운 무관 문서를 근거처럼 저장하지 않습니다.
    const selected = scenario.expectedSource ? expected || rows[0] || null : null;
    const similarity = selected ? Number(selected.similarity || 0) : null;
    const keywordHits = selected ? Number(selected.keyword_hits || 0) : 0;
    const status = !scenario.expectedSource
      ? "needs_knowledge"
      : expected && (similarity >= 0.22 || keywordHits > 0) ? "passed" : "failed";

    results.push({
      ...scenario,
      status,
      matchedSource: selected ? String(selected.metadata?.title || selected.metadata?.fileName || "팀 지식 문서") : null,
      evidencePreview: selected ? String(selected.content || "").replace(/\s+/g, " ").trim().slice(0, 420) : null,
      similarity,
      keywordHits,
      retrievalMs: Date.now() - started,
    });
  }

  await sql.begin(async transaction => {
    for (const result of results) {
      await transaction`
        insert into public.synthetic_evaluations
          (scenario_key, question, topic, expected_source, status, matched_source,
           evidence_preview, similarity, keyword_hits, retrieval_ms, evaluated_at, synthetic)
        values
          (${result.key}, ${result.question}, ${result.topic}, ${result.expectedSource}, ${result.status},
           ${result.matchedSource}, ${result.evidencePreview}, ${result.similarity}, ${result.keywordHits},
           ${result.retrievalMs}, now(), true)
        on conflict (scenario_key) do update set
          question = excluded.question,
          topic = excluded.topic,
          expected_source = excluded.expected_source,
          status = excluded.status,
          matched_source = excluded.matched_source,
          evidence_preview = excluded.evidence_preview,
          similarity = excluded.similarity,
          keyword_hits = excluded.keyword_hits,
          retrieval_ms = excluded.retrieval_ms,
          evaluated_at = excluded.evaluated_at,
          synthetic = true
      `;
    }
  });

  const passed = results.filter(item => item.status === "passed").length;
  const gaps = results.filter(item => item.status === "needs_knowledge").length;
  console.log(`합성 시나리오 ${results.length}건 저장 · 검색 통과 ${passed}건 · 지식 필요 ${gaps}건`);
} finally {
  await sql.end();
}
