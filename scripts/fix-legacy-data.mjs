/**
 * 교육 과정에서 남은 이상한 기록을 정리합니다.
 *
 *   npm run fix-legacy            미리보기 (아무것도 바꾸지 않습니다)
 *   npm run fix-legacy -- --apply 실제로 적용
 *
 * 무엇을 고치는가
 *  1) 인코딩이 깨진 질문 — 한글이 전부 '?'로 저장된 행입니다. 원문을 복구할 방법이
 *     없어 삭제합니다.
 *  2) 답변이 "근거가 부족합니다"인데 답변완료로 기록된 행 — 예전 코드가 모델의
 *     근거부족 응답을 판정하지 못해 생긴 오분류입니다. 미답변으로 되돌려
 *     관리자 대기열에 올리고 지표(답변완료율)를 바로잡습니다.
 *  3) 어느 답변에 대한 것인지 연결이 없는 피드백 — chat_log_id 가 비어 있어
 *     만족도 지표에만 잡히고 추적이 불가능한 행입니다. 삭제 여부는 선택입니다
 *     (--drop-orphan-feedback 을 붙였을 때만 지웁니다).
 */
import fs from "node:fs";

const { default: postgres } = await import("postgres");

const APPLY = process.argv.includes("--apply");
const DROP_FEEDBACK = process.argv.includes("--drop-orphan-feedback");

function envValue(key) {
  if (process.env[key]) return process.env[key];
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && match[1] === key) return match[2].replace(/^"|"$/g, "").trim();
    }
  } catch { /* 파일이 없을 수 있습니다 */ }
  return "";
}

const raw = envValue("DATABASE_URL");
if (!raw) { console.error(".env.local 에서 DATABASE_URL 을 찾지 못했습니다."); process.exit(1); }

const match = raw.match(/^postgres(?:ql)?:\/\/([^:@/]+):(.+)@([^@]+)$/);
const url = match
  ? `postgresql://${encodeURIComponent(match[1])}:${encodeURIComponent(
      match[2].startsWith("[") && match[2].endsWith("]") ? match[2].slice(1, -1) : match[2],
    )}@${match[3]}`
  : raw;

const sql = postgres(url, { max: 1, prepare: false, ssl: "require", connect_timeout: 20 });

try {
  // 1) 인코딩이 깨진 질문: 한글이 하나도 없고 '?'가 3개 이상인 행
  const broken = await sql`
    select id, user_message from public.chat_logs
    where user_message !~ '[가-힣]'
      and length(user_message) - length(replace(user_message, '?', '')) >= 3
  `;

  // 2) 근거부족인데 답변완료로 기록된 행
  const mislabeled = await sql`
    select id, user_message, bot_answer from public.chat_logs
    where not coalesce(is_fallback, false)
      and bot_answer ilike '%근거가 부족합니다%'
      and length(bot_answer) < 40
  `;

  // 3) 답변과 연결되지 않은 피드백
  const orphanFeedback = await sql`
    select id, rating, left(user_message, 40) as user_message
    from public.feedback where chat_log_id is null
  `;

  console.log("=== 1) 인코딩이 깨진 질문 ===");
  if (!broken.length) console.log("  없음");
  for (const row of broken) console.log(`  #${row.id}  "${row.user_message}"  → 삭제`);

  console.log("\n=== 2) 근거부족인데 답변완료로 기록된 행 ===");
  if (!mislabeled.length) console.log("  없음");
  for (const row of mislabeled) {
    console.log(`  #${row.id}  "${row.user_message}"`);
    console.log(`        답변: "${row.bot_answer.trim()}"  → 미답변으로 변경`);
  }

  console.log("\n=== 3) 연결이 끊긴 피드백 ===");
  if (!orphanFeedback.length) console.log("  없음");
  for (const row of orphanFeedback) {
    console.log(`  #${row.id}  ${row.rating > 0 ? "긍정" : "부정"}  "${row.user_message}"`);
  }
  if (orphanFeedback.length && !DROP_FEEDBACK) {
    console.log("  → 그대로 둡니다. 지우려면 --drop-orphan-feedback 을 붙이세요.");
    console.log("     (지우면 만족도 지표에서 이 행들이 빠집니다.)");
  }

  if (!APPLY) {
    console.log("\n미리보기입니다. 실제로 적용하려면: npm run fix-legacy -- --apply");
  } else {
    console.log("\n--- 적용 ---");
    if (broken.length) {
      const ids = broken.map(row => Number(row.id));
      const removed = await sql`delete from public.chat_logs where id = any(${ids}::bigint[]) returning id`;
      console.log(`깨진 질문 ${removed.length}건 삭제`);
    }
    if (mislabeled.length) {
      const ids = mislabeled.map(row => Number(row.id));
      const updated = await sql`
        update public.chat_logs
        set is_fallback = true, category = 'fallback'
        where id = any(${ids}::bigint[]) returning id
      `;
      console.log(`오분류 ${updated.length}건을 미답변으로 변경`);
    }
    if (orphanFeedback.length && DROP_FEEDBACK) {
      const removed = await sql`delete from public.feedback where chat_log_id is null returning id`;
      console.log(`연결 끊긴 피드백 ${removed.length}건 삭제`);
    }

    console.log("\n=== 정리 후 상태 ===");
    const [summary] = await sql`
      select count(*)::int as logs,
             count(*) filter (where coalesce(is_fallback, false))::int as unanswered,
             (select count(*)::int from public.feedback) as feedback
      from public.chat_logs
    `;
    console.log(`대화 로그 ${summary.logs}건 (미답변 ${summary.unanswered}건), 피드백 ${summary.feedback}건`);
  }
} catch (error) {
  console.error("실패:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 10 });
}
