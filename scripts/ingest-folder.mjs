/**
 * 폴더 안의 문서를 한 번에 지식으로 적재합니다.
 *
 *   npm run ingest -- <폴더> [옵션]
 *
 * 예)
 *   npm run ingest -- knowledge-templates
 *   npm run ingest -- "C:\\사내자료\\인사" --category 인사
 *   npm run ingest -- ./docs --dry-run
 *
 * 옵션
 *   --category <이름>   모든 파일에 같은 카테고리를 붙입니다(기본: 폴더 이름)
 *   --url <주소>        모든 파일에 같은 출처 URL을 붙입니다
 *   --dry-run           올리지 않고 대상 목록만 보여 줍니다
 *   --base <주소>       서버 주소 (기본: http://localhost:3000)
 *   --replace           같은 내용이 이미 있으면 덮어씁니다
 *
 * 개발 서버가 켜져 있어야 합니다. 앱의 업로드 API를 그대로 쓰기 때문에
 * 청킹·임베딩·중복검사 동작이 관리자 화면에서 올릴 때와 완전히 같습니다.
 */
import fs from "node:fs";
import path from "node:path";

const SUPPORTED = new Set([".pdf", ".docx", ".txt", ".md"]);
const MAX_BYTES = 20 * 1024 * 1024;

/** 값을 받는 옵션과 안 받는 옵션을 구분해서 파싱합니다. */
const VALUE_FLAGS = new Set(["category", "url", "base"]);
const BOOLEAN_FLAGS = new Set(["dry-run", "replace"]);

const options = {};
const positional = [];
{
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const name = arg.slice(2);
    if (VALUE_FLAGS.has(name)) { options[name] = argv[index + 1]; index += 1; }
    else if (BOOLEAN_FLAGS.has(name)) options[name] = true;
    else { console.error(`모르는 옵션입니다: ${arg}`); process.exit(1); }
  }
}
const flag = name => options[name];
const has = name => Boolean(options[name]);

const folder = positional[0];
const BASE = flag("base") || process.env.INGEST_BASE_URL || "http://localhost:3000";
const DRY_RUN = has("dry-run");
const REPLACE = has("replace");

if (!folder) {
  console.error("사용법: npm run ingest -- <폴더> [--category 이름] [--dry-run]");
  process.exit(1);
}
if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
  console.error(`폴더를 찾지 못했습니다: ${folder}`);
  process.exit(1);
}

const defaultCategory = flag("category") || path.basename(path.resolve(folder));
const sourceUrl = flag("url") || "";

/** 지식이 아니라 설명서인 파일들 — 올릴 대상이 아닙니다. */
const IGNORED_NAMES = new Set(["readme.md", "readme.txt", "changelog.md", "license.md"]);

/** 하위 폴더까지 훑되, 지원하지 않는 확장자와 숨김 파일은 건너뜁니다. */
function collect(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { found.push(...collect(full)); continue; }
    if (IGNORED_NAMES.has(entry.name.toLowerCase())) continue;
    if (!SUPPORTED.has(path.extname(entry.name).toLowerCase())) continue;
    found.push(full);
  }
  return found;
}

const files = collect(folder).sort();
if (!files.length) {
  console.error(`올릴 수 있는 파일이 없습니다. 지원 형식: ${[...SUPPORTED].join(", ")}`);
  process.exit(1);
}

console.log(`대상 폴더 : ${path.resolve(folder)}`);
console.log(`서버      : ${BASE}`);
console.log(`카테고리  : ${defaultCategory}`);
console.log(`파일 ${files.length}개\n`);

/** 템플릿을 그대로 올리는 실수를 막습니다. */
function looksLikeTemplate(file) {
  if (path.extname(file).toLowerCase() !== ".md") return false;
  const text = fs.readFileSync(file, "utf8");
  return text.includes("(내용을 채워 주세요)") || text.includes("(채워 주세요)");
}

if (DRY_RUN) {
  for (const file of files) {
    const size = fs.statSync(file).size;
    const warn = looksLikeTemplate(file) ? "  ← 아직 안 채운 템플릿으로 보입니다" : "";
    console.log(`  ${path.relative(folder, file).padEnd(44)} ${String(size).padStart(8)} bytes${warn}`);
  }
  console.log("\n미리보기입니다. --dry-run 을 빼면 실제로 올립니다.");
  process.exit(0);
}

const password = process.env.ADMIN_PASSWORD || readEnvLocal("ADMIN_PASSWORD");
if (!password) {
  console.error("ADMIN_PASSWORD 를 찾지 못했습니다. .env.local 에 설정해 주세요.");
  process.exit(1);
}

const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
}).catch(error => {
  console.error(`서버에 연결하지 못했습니다(${BASE}). 개발 서버가 켜져 있는지 확인해 주세요.`);
  console.error(`  ${error.message}`);
  process.exit(1);
});

if (!login.ok) {
  console.error(`관리자 로그인 실패: ${login.status} ${await login.text()}`);
  process.exit(1);
}
const cookie = (login.headers.get("set-cookie") || "").split(";")[0];

const results = { ok: [], skipped: [], failed: [] };

for (const [index, file] of files.entries()) {
  const name = path.basename(file);
  const title = name.replace(/\.[^.]+$/, "").replace(/^\d+[-_. ]*/, "");
  const label = `[${index + 1}/${files.length}] ${name}`;

  if (looksLikeTemplate(file)) {
    console.log(`${label}  건너뜀 — 아직 채우지 않은 템플릿입니다`);
    results.skipped.push({ name, reason: "빈 템플릿" });
    continue;
  }

  const size = fs.statSync(file).size;
  if (size === 0 || size > MAX_BYTES) {
    console.log(`${label}  건너뜀 — 크기 ${size} bytes`);
    results.skipped.push({ name, reason: `크기 ${size} bytes` });
    continue;
  }

  // 폴더 구조를 카테고리로 씁니다. 예: docs/인사/온보딩.md → 카테고리 "인사"
  const relative = path.relative(folder, file);
  const parent = path.dirname(relative);
  const category = flag("category") || (parent === "." ? defaultCategory : parent.split(path.sep)[0]);

  process.stdout.write(`${label}  … `);
  try {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(file)]), name);
    form.append("title", title);
    form.append("category", category);
    if (sourceUrl) form.append("sourceUrl", sourceUrl);
    if (REPLACE) form.append("replace", "true");

    const response = await fetch(`${BASE}/api/knowledge/upload`, { method: "POST", headers: { cookie }, body: form });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data.error || `HTTP ${response.status}`;
      if (message.includes("이미 등록")) {
        console.log("이미 등록된 문서 (건너뜀)");
        results.skipped.push({ name, reason: "중복" });
      } else {
        console.log(`실패 — ${message}`);
        results.failed.push({ name, reason: message });
      }
      continue;
    }

    console.log(`청크 ${data.document?.chunks ?? 0}개 · 카테고리 ${category}`);
    results.ok.push({ name, chunks: data.document?.chunks ?? 0 });
  } catch (error) {
    console.log(`실패 — ${error.message}`);
    results.failed.push({ name, reason: error.message });
  }
}

console.log(`\n=== 완료: 성공 ${results.ok.length} / 건너뜀 ${results.skipped.length} / 실패 ${results.failed.length} ===`);
if (results.ok.length) {
  console.log(`적재한 청크 ${results.ok.reduce((sum, item) => sum + item.chunks, 0)}개`);
}
for (const item of results.skipped) console.log(`  건너뜀  ${item.name} — ${item.reason}`);
for (const item of results.failed) console.log(`  실패    ${item.name} — ${item.reason}`);
if (results.failed.length) process.exitCode = 1;

function readEnvLocal(key) {
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && match[1] === key) return match[2].replace(/^"|"$/g, "").trim();
    }
  } catch { /* .env.local 이 없을 수도 있습니다 */ }
  return "";
}
