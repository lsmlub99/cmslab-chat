"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { Bot, Database, FileText, Gauge, LayoutDashboard, LogOut, MessageCircleQuestion, Pencil, Settings, Trash2, Upload } from "lucide-react";
import type { ConversationLog, DashboardData, KnowledgeDocument, UnansweredQuestion } from "@/lib/types";

type Section = "overview" | "settings" | "knowledge" | "upload" | "questions" | "metrics" | "logs";
type SettingsData = { bot_name: string; team_name: string; welcome_message: string; accent_color: string };

const NAV: { id: Section; label: string; icon: typeof Settings }[] = [
  { id: "overview", label: "성과 대시보드", icon: LayoutDashboard },
  { id: "settings", label: "챗봇 설정", icon: Settings },
  { id: "knowledge", label: "지식 문서", icon: Database },
  { id: "upload", label: "지식 업로드", icon: Upload },
  { id: "questions", label: "미답변 질문", icon: MessageCircleQuestion },
  { id: "metrics", label: "성과지표 관리", icon: Gauge },
  { id: "logs", label: "대화 기록", icon: FileText },
];

async function getJson(url: string, options?: RequestInit) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    // 세션이 만료됐습니다. 로그인 화면으로 돌려보냅니다.
    location.href = "/admin/login";
    throw new Error("관리자 로그인이 필요합니다.");
  }
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}

export default function AdminShell() {
  const [section, setSection] = useState<Section>("overview");
  const [settings, setSettings] = useState<SettingsData>({
    bot_name: "답봇", team_name: "교육 대표팀",
    welcome_message: "안녕하세요. 팀 지식에서 근거를 찾아 답해드릴게요.", accent_color: "#273e82",
  });
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [questions, setQuestions] = useState<UnansweredQuestion[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData>();
  const [setupError, setSetupError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const loadSettings = useCallback(async () => {
    try { setSettings(await getJson("/api/settings")); }
    catch (error) { setSetupError(error instanceof Error ? error.message : "설정을 불러오지 못했습니다."); }
  }, []);

  const loadDocuments = useCallback(async () => {
    try { setDocuments(await getJson("/api/knowledge")); setSetupError(""); }
    catch (error) { setSetupError(error instanceof Error ? error.message : "지식 문서를 불러오지 못했습니다."); }
  }, []);

  const loadQuestions = useCallback(async () => {
    try { setQuestions(await getJson("/api/questions/unanswered")); }
    catch { /* 대시보드 진입은 막지 않습니다. */ }
  }, []);

  const loadDashboard = useCallback(async (from?: string, to?: string) => {
    const query = from && to
      ? `?from=${encodeURIComponent(`${from}T00:00:00.000Z`)}&to=${encodeURIComponent(`${to}T23:59:59.999Z`)}`
      : "?days=30";
    try { setDashboard(await getJson(`/api/dashboard${query}`)); }
    catch (error) { setSetupError(error instanceof Error ? error.message : "지표를 불러오지 못했습니다."); }
  }, []);

  useEffect(() => {
    void loadSettings(); void loadDocuments(); void loadQuestions(); void loadDashboard();
  }, [loadSettings, loadDocuments, loadQuestions, loadDashboard]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3000);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    try {
      setSettings(await getJson("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      }));
      flash("챗봇 설정을 저장했습니다.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "설정을 저장하지 못했습니다.");
    } finally { setLoading(false); }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" }).catch(() => undefined);
    location.href = "/admin/login";
  }

  async function deleteDocument(id: number) {
    if (!confirm("이 문서의 모든 청크를 삭제할까요? 되돌릴 수 없습니다.")) return;
    try {
      const result = await getJson(`/api/knowledge/${id}`, { method: "DELETE" });
      setDocuments(current => current.filter(item => item.id !== id));
      flash(`청크 ${result.removed ?? 0}개를 삭제했습니다.`);
      void loadDashboard();
    } catch (error) {
      flash(error instanceof Error ? error.message : "삭제하지 못했습니다.");
    }
  }

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">{settings.bot_name || "답봇"}<small>반복 질문 지식베이스</small></div>
        <div className="side-kicker">ADMIN CONSOLE</div>
        <nav className="nav">
          {NAV.map(item => {
            const Icon = item.icon;
            return (
              <button className={section === item.id ? "active" : ""} key={item.id} onClick={() => setSection(item.id)}>
                <Icon size={16}/>{item.label}
              </button>
            );
          })}
          <button onClick={() => { location.href = "/"; }}><Bot size={16}/> 사용자 채팅으로</button>
        </nav>
        <div className="side-foot">팀 지식과 챗봇 응답을<br/>관리하는 공간입니다.</div>
      </aside>

      <main className="shell">
        <header className="top">
          <div>
            <div className="eyebrow">ADMINISTRATION</div>
            <h1 className="title">{NAV.find(item => item.id === section)?.label || "관리자"}</h1>
          </div>
          <div className="person admin-user">
            <span>{dashboard ? `지식 ${dashboard.totals.documents}건 · 청크 ${dashboard.totals.chunks}개` : "연결 확인 중"}</span>
            <button className="btn soft" onClick={logout}><LogOut size={13}/> 로그아웃</button>
            <span className="avatar">관</span>
          </div>
        </header>

        {setupError && (
          <div className="notice">
            데이터를 불러오지 못했습니다. `.env.local`의 DATABASE_URL·OPENAI_API_KEY를 확인하고
            supabase/migrations의 SQL을 적용해 주세요. ({setupError})
          </div>
        )}
        {dashboard && dashboard.totals.embedded < dashboard.totals.chunks && (
          <div className="notice">
            임베딩이 없는 청크가 {dashboard.totals.chunks - dashboard.totals.embedded}개 있습니다.
            해당 청크는 벡터 검색에 걸리지 않습니다. 문서를 다시 업로드하면 임베딩이 생성됩니다.
          </div>
        )}
        {notice && (
          <div className="notice" style={{ background: "#e9f8f2", borderColor: "#c8eadb", color: "#176b52" }}>{notice}</div>
        )}

        <div className="admin-grid">
          <nav className="card admin-menu">
            {NAV.map(item => (
              <button className={section === item.id ? "active" : ""} key={item.id} onClick={() => setSection(item.id)}>
                {item.label}
              </button>
            ))}
          </nav>

          <section className="admin-body">
            {section === "overview" && <Overview data={dashboard} onRefresh={loadDashboard}/>}
            {section === "settings" && <SettingsPanel value={settings} setValue={setSettings} onSubmit={saveSettings} loading={loading}/>}
            {section === "knowledge" && (
              <KnowledgePanel
                documents={documents}
                onDelete={deleteDocument}
                onUpload={() => setSection("upload")}
                onSaved={message => { void loadDocuments(); void loadDashboard(); flash(message); }}
                onError={flash}
              />
            )}
            {section === "upload" && (
              <UploadPanel
                onDone={message => { void loadDocuments(); void loadDashboard(); setSection("knowledge"); flash(message); }}
                onError={flash}
              />
            )}
            {section === "questions" && (
              <QuestionsPanel
                questions={questions}
                onDone={() => { void loadQuestions(); void loadDocuments(); void loadDashboard(); flash("답변을 지식으로 등록했습니다."); }}
                onError={flash}
              />
            )}
            {section === "metrics" && <MetricsPanel data={dashboard}/>}
            {section === "logs" && <LogsPanel/>}
          </section>
        </div>
      </main>
    </div>
  );
}

/* ── 성과 대시보드 ─────────────────────────────────────────────────────────── */

function Overview({ data, onRefresh }: { data?: DashboardData; onRefresh: (from?: string, to?: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);

  if (!data) return <section className="card"><div className="empty">지표를 불러오는 중입니다…</div></section>;

  const t = data.totals;
  const peak = Math.max(1, ...data.series.map(day => day.questions));

  return (
    <>
      <section className="stats">
        <Stat label="질문 수" value={`${t.questions}건`} note={`재질문 ${t.followups}건`}/>
        <Stat label="사용자 수" value={`${t.users}명`} note="기간 내 활동 사용자"/>
        <Stat label="답변 완료율" value={`${t.answeredRate}%`} note={`미답변 ${t.unansweredRate}%`}/>
        <Stat label="지식 재사용" value={`${t.reuse}회`} note="답변에 인용된 누적 횟수"/>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>질문·답변 추이</h2>
            <div className="hint">선택한 기간의 chat_logs를 집계합니다.</div>
          </div>
          <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
            <input type="date" value={from} max={to} onChange={event => setFrom(event.target.value)}/>
            <span className="hint">~</span>
            <input type="date" value={to} min={from} onChange={event => setTo(event.target.value)}/>
            <button className="btn soft" onClick={() => onRefresh(from, to)}>조회</button>
          </div>
        </div>

        {data.series.length ? (
          <div className="chart">
            {data.series.map(day => (
              <div
                className="bar"
                key={day.date}
                style={{ height: `${Math.max(6, Math.round((day.questions / peak) * 100))}%` }}
                data-label={day.label}
                data-value={day.questions}
                title={`${day.label} · 질문 ${day.questions}건 / 답변 ${day.answered}건`}
              />
            ))}
          </div>
        ) : (
          <div className="empty">이 기간에는 질문 기록이 없습니다.</div>
        )}

        <div className="kpi-grid">
          <Kpi label="출처 포함 답변률" value={`${t.citationRate}%`}/>
          <Kpi label="평균 응답 시간" value={t.avgResponseMs ? `${(t.avgResponseMs / 1000).toFixed(1)}초` : "기록 없음"}/>
          <Kpi label="만족도" value={t.satisfaction === null ? "응답 없음" : `${t.satisfaction}% (${t.feedbackCount}건)`}/>
          <Kpi label="평균 근거 유사도" value={t.avgSimilarity ? t.avgSimilarity.toFixed(3) : "기록 없음"}/>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div><h2>주제별 질문</h2><div className="hint">답변에 사용된 지식의 카테고리 기준</div></div>
        </div>
        {data.topics.length ? (
          <div>
            {data.topics.map(topic => (
              <div className="topic-row" key={topic.category}>
                <b>{topic.category}</b>
                <span>{topic.questions}건 · 답변 {topic.answered}건</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">집계할 질문이 없습니다.</div>
        )}
      </section>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="stat"><label>{label}</label><strong>{value}</strong><span className="up">{note}</span></div>;
}
function Kpi({ label, value }: { label: string; value: string }) {
  return <div className="kpi"><span>{label}</span><strong>{value}</strong></div>;
}

/* ── 챗봇 설정 ─────────────────────────────────────────────────────────────── */

function SettingsPanel({ value, setValue, onSubmit, loading }: {
  value: SettingsData; setValue: (value: SettingsData) => void; onSubmit: (event: FormEvent) => void; loading: boolean;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>챗봇 기본 설정</h2>
          <div className="hint">팀원이 질문할 때 보이는 이름과 안내 문구입니다. workspace_settings에 저장됩니다.</div>
        </div>
      </div>
      <form onSubmit={onSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>챗봇 이름</label>
            <input value={value.bot_name} maxLength={60} onChange={e => setValue({ ...value, bot_name: e.target.value })}/>
          </div>
          <div className="field">
            <label>팀 이름</label>
            <input value={value.team_name} maxLength={60} onChange={e => setValue({ ...value, team_name: e.target.value })}/>
          </div>
          <div className="field full">
            <label>첫 인사말</label>
            <textarea value={value.welcome_message} maxLength={500} onChange={e => setValue({ ...value, welcome_message: e.target.value })}/>
          </div>
          <div className="field">
            <label>강조색</label>
            <input type="color" value={value.accent_color} onChange={e => setValue({ ...value, accent_color: e.target.value })}/>
          </div>
          <div className="field">
            <label>검색 방식</label>
            <select value="hybrid" disabled>
              <option value="hybrid">벡터 + 키워드 하이브리드 검색</option>
            </select>
          </div>
        </div>
        <div className="actions">
          <button className="btn primary" disabled={loading}>{loading ? "저장 중…" : "설정 저장"}</button>
        </div>
      </form>
    </section>
  );
}

/* ── 지식 문서 ─────────────────────────────────────────────────────────────── */

type EditingDocument = {
  id: number;
  title: string;
  category: string;
  body: string;
  sourceLabel: string;
  sourceUrl: string;
  chunks: number;
};

function KnowledgePanel({ documents, onDelete, onUpload, onSaved, onError }: {
  documents: KnowledgeDocument[];
  onDelete: (id: number) => void;
  onUpload: () => void;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState<EditingDocument>();
  const [loadingId, setLoadingId] = useState<number>();
  const [busy, setBusy] = useState(false);

  async function startEdit(id: number) {
    setLoadingId(id);
    try {
      const data = await getJson(`/api/knowledge/${id}`);
      setEditing({
        id,
        title: data.title || "",
        category: data.category || "일반",
        body: data.body || "",
        sourceLabel: data.source_label || "",
        sourceUrl: data.source_url || "",
        chunks: data.chunks || 0,
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : "문서를 불러오지 못했습니다.");
    } finally {
      setLoadingId(undefined);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const saved = await getJson(`/api/knowledge/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editing.title,
          category: editing.category,
          body: editing.body,
          sourceLabel: editing.sourceLabel,
          sourceUrl: editing.sourceUrl,
        }),
      });
      setEditing(undefined);
      onSaved(`청크 ${saved.document?.chunks ?? 0}개로 다시 나누고 임베딩했습니다.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "수정하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <section className="card">
        <div className="card-head">
          <div>
            <h2>지식 문서 수정</h2>
            <div className="hint">
              저장하면 기존 청크 {editing.chunks}개를 지우고 새 본문으로 다시 청킹·임베딩합니다.
            </div>
          </div>
        </div>
        <form onSubmit={save}>
          <div className="form-grid">
            <div className="field">
              <label>문서 제목</label>
              <input required value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })}/>
            </div>
            <div className="field">
              <label>카테고리</label>
              <input value={editing.category} onChange={e => setEditing({ ...editing, category: e.target.value })}/>
            </div>
            <div className="field full">
              <label>본문</label>
              <textarea
                required
                minLength={20}
                style={{ minHeight: 320 }}
                value={editing.body}
                onChange={e => setEditing({ ...editing, body: e.target.value })}
              />
            </div>
            <div className="field">
              <label>출처 이름</label>
              <input value={editing.sourceLabel} onChange={e => setEditing({ ...editing, sourceLabel: e.target.value })}/>
            </div>
            <div className="field">
              <label>출처 URL</label>
              <input type="url" value={editing.sourceUrl} onChange={e => setEditing({ ...editing, sourceUrl: e.target.value })}/>
            </div>
          </div>
          <div className="actions">
            <button type="button" className="btn soft" onClick={() => setEditing(undefined)}>취소</button>
            <button className="btn primary" disabled={busy}>{busy ? "다시 임베딩 중…" : "저장하고 다시 임베딩"}</button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>지식 문서 관리</h2>
          <div className="hint">public.documents의 청크를 문서 단위로 묶어 보여 줍니다.</div>
        </div>
        <button className="btn primary" onClick={onUpload}>+ 지식 업로드</button>
      </div>

      {documents.length ? (
        <div className="list">
          {documents.map(doc => {
            const missing = (doc.chunks ?? 0) - (doc.embedded ?? doc.chunks ?? 0);
            return (
              <article className="question" key={doc.source_hash || doc.id}>
                <div className="question-title">{doc.title}</div>
                <div className="meta">
                  {doc.category || "일반"} · {(doc.file_type || "text").toUpperCase()} · {doc.chunks}개 청크 ·
                  재사용 {doc.reuse_count}회
                  {doc.created_at ? ` · ${new Date(doc.created_at).toLocaleDateString("ko-KR")}` : ""}
                </div>
                <span className={`badge ${missing > 0 ? "red" : ""}`}>
                  {missing > 0 ? `임베딩 누락 ${missing}개` : "검색 가능"}
                </span>
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <button className="btn soft" disabled={loadingId === doc.id} onClick={() => startEdit(doc.id)}>
                    <Pencil size={13}/> {loadingId === doc.id ? "불러오는 중…" : "수정"}
                  </button>
                  <button className="btn danger" onClick={() => onDelete(doc.id)}>
                    <Trash2 size={13}/> 삭제
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty">아직 등록된 지식 문서가 없습니다. 지식 업로드에서 첫 문서를 추가하세요.</div>
      )}
    </section>
  );
}

/* ── 지식 업로드 ───────────────────────────────────────────────────────────── */

function UploadPanel({ onDone, onError }: { onDone: (message: string) => void; onError: (message: string) => void }) {
  const [tab, setTab] = useState<"file" | "text">("file");
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("일반");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      let response: Response;
      if (tab === "file") {
        if (!file) throw new Error("파일을 선택해 주세요.");
        const form = new FormData();
        form.append("file", file);
        form.append("title", title || file.name);
        form.append("category", category);
        form.append("sourceLabel", sourceLabel);
        form.append("sourceUrl", sourceUrl);
        response = await fetch("/api/knowledge/upload", { method: "POST", body: form });
      } else {
        response = await fetch("/api/knowledge/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, category, body, sourceLabel, sourceUrl }),
        });
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "지식을 등록하지 못했습니다.");
      onDone(`청크 ${data.document?.chunks ?? 0}개를 임베딩해 저장했습니다.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : "지식을 등록하지 못했습니다.");
    } finally { setBusy(false); }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>지식 등록</h2>
          <div className="hint">텍스트 추출 → 청킹 → OpenAI 임베딩 생성 → public.documents 저장 순으로 처리합니다.</div>
        </div>
      </div>

      <div className="nav" style={{ display: "flex", marginBottom: 18 }}>
        <button className={tab === "file" ? "active" : ""} onClick={() => setTab("file")}>파일 업로드</button>
        <button className={tab === "text" ? "active" : ""} onClick={() => setTab("text")}>텍스트 직접 입력</button>
      </div>

      <form onSubmit={submit}>
        <div className="form-grid">
          <div className="field">
            <label>문서 제목</label>
            <input required value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 신규 입사자 온보딩 가이드"/>
          </div>
          <div className="field">
            <label>카테고리</label>
            <input value={category} onChange={e => setCategory(e.target.value)} placeholder="복리후생, IT, 온보딩"/>
          </div>
          <div className="field full">
            <label>{tab === "file" ? "파일" : "본문"}</label>
            {tab === "file" ? (
              <div className="upload-box">
                <FileText size={26} color="var(--blue)"/>
                <div className="hint">PDF · DOCX · TXT · MD, 최대 20MB</div>
                <input required type="file" accept=".pdf,.docx,.txt,.md" onChange={e => setFile(e.target.files?.[0])}/>
              </div>
            ) : (
              <textarea required minLength={20} value={body} onChange={e => setBody(e.target.value)}
                placeholder="챗봇이 답변에 사용할 팀 지식을 입력하세요. (20자 이상)"/>
            )}
          </div>
          <div className="field">
            <label>출처 이름</label>
            <input value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} placeholder="예: 인사팀 가이드"/>
          </div>
          <div className="field">
            <label>출처 URL</label>
            <input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://..."/>
          </div>
        </div>
        <div className="actions">
          <button className="btn primary" disabled={busy}>{busy ? "임베딩 생성 중…" : "지식 저장 및 청킹 시작"}</button>
        </div>
      </form>
    </section>
  );
}

/* ── 미답변 질문 ───────────────────────────────────────────────────────────── */

function QuestionsPanel({ questions, onDone, onError }: {
  questions: UnansweredQuestion[]; onDone: () => void; onError: (message: string) => void;
}) {
  const [answerId, setAnswerId] = useState<number>();
  const [answer, setAnswer] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`/api/questions/${answerId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer, sourceUrl, sourceLabel: sourceUrl ? "관리자 답변 근거" : undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "답변을 저장하지 못했습니다.");
      setAnswerId(undefined); setAnswer(""); setSourceUrl("");
      onDone();
    } catch (error) {
      onError(error instanceof Error ? error.message : "답변을 저장하지 못했습니다.");
    } finally { setBusy(false); }
  }

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>미답변 질문 대기열</h2>
          <div className="hint">등록한 답변은 즉시 임베딩되어 다음 질문부터 검색됩니다.</div>
        </div>
        <span className={`badge ${questions.length ? "red" : ""}`}>{questions.length}건</span>
      </div>

      {questions.length ? (
        <div className="list">
          {questions.map(item => (
            <article className="question unanswered" key={item.id}>
              <div className="question-title">{item.question}</div>
              <div className="meta">
                {new Date(item.created_at).toLocaleString("ko-KR")} · {item.user_key || "익명"}
                {item.top_similarity !== null ? ` · 최고 유사도 ${item.top_similarity.toFixed(3)}` : ""}
              </div>
              <span className="badge red">미답변</span>
              {answerId === item.id ? (
                <form onSubmit={save} style={{ marginTop: 14 }}>
                  <div className="field">
                    <label>답변</label>
                    <textarea required minLength={20} value={answer} onChange={e => setAnswer(e.target.value)}
                      placeholder="팀에서 확인한 정확한 답변을 입력하세요. (20자 이상)"/>
                  </div>
                  <div className="field" style={{ marginTop: 10 }}>
                    <label>근거 문서 URL</label>
                    <input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="선택 사항"/>
                  </div>
                  <div className="actions">
                    <button type="button" className="btn soft" onClick={() => setAnswerId(undefined)}>취소</button>
                    <button className="btn primary" disabled={busy}>{busy ? "등록 중…" : "답변을 지식으로 등록"}</button>
                  </div>
                </form>
              ) : (
                <button className="btn soft" style={{ marginTop: 12 }} onClick={() => { setAnswerId(item.id); setAnswer(""); }}>
                  답변 작성
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <div className="empty">현재 미답변 질문이 없습니다.</div>
      )}
    </section>
  );
}

/* ── 성과지표 ──────────────────────────────────────────────────────────────── */

function MetricsPanel({ data }: { data?: DashboardData }) {
  if (!data) return <section className="card"><div className="empty">지표를 불러오는 중입니다…</div></section>;
  const t = data.totals;

  const rows = [
    ["질문 수와 재질문 수", "정량", `${t.questions}건 / 재질문 ${t.followups}건`, "chat_logs 기간 집계"],
    ["사용자 수", "정량", `${t.users}명`, "chat_logs.user_id 고유 수"],
    ["만족도", "정성", t.satisfaction === null ? "응답 없음" : `${t.satisfaction}% 긍정 (${t.feedbackCount}건)`, "feedback.rating"],
    ["미답변 비율", "운영", `${t.unansweredRate}%`, "근거 부족으로 대기열에 등록된 비율"],
    ["출처 포함 답변률", "운영", `${t.citationRate}%`, "chat_log_citations 보유 답변 비율"],
    ["평균 응답 시간", "운영", t.avgResponseMs ? `${(t.avgResponseMs / 1000).toFixed(1)}초` : "기록 없음", "chat_logs.response_ms"],
    ["지식 재사용", "운영", `${t.reuse}회`, "documents.reuse_count 합계"],
    ["지식 적재량", "운영", `문서 ${t.documents}건 / 청크 ${t.chunks}개 (임베딩 ${t.embedded}개)`, "public.documents"],
  ];

  return (
    <section className="card">
      <div className="card-head">
        <div><h2>성과지표 관리</h2><div className="hint">모든 값은 실제 DB 집계입니다.</div></div>
        <button className="btn soft" onClick={() => downloadCsv(rows)}>CSV 다운로드</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>지표</th><th>유형</th><th>현재값</th><th>측정 방법</th></tr></thead>
          <tbody>
            {rows.map(row => (
              <tr key={row[0]}><td>{row[0]}</td><td>{row[1]}</td><td>{row[2]}</td><td>{row[3]}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function downloadCsv(rows: string[][]) {
  const today = new Date().toISOString().slice(0, 10);
  const escape = (cell: string) => `"${String(cell).replace(/"/g, '""')}"`;
  const csv = "﻿" + [["지표", "유형", "현재값", "측정 방법", "기준일"], ...rows.map(row => [...row, today])]
    .map(row => row.map(escape).join(",")).join("\r\n");
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  anchor.href = url;
  anchor.download = `답봇-성과지표-${today}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/* ── 대화 기록 ─────────────────────────────────────────────────────────────── */

function LogsPanel() {
  const [logs, setLogs] = useState<ConversationLog[]>();
  const [filter, setFilter] = useState<"all" | "answered" | "unanswered">("all");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLogs(undefined); setError("");
    getJson(`/api/logs?filter=${filter}&limit=50`)
      .then(data => { if (!cancelled) setLogs(data); })
      .catch(problem => { if (!cancelled) setError(problem instanceof Error ? problem.message : "불러오지 못했습니다."); });
    return () => { cancelled = true; };
  }, [filter]);

  return (
    <section className="card">
      <div className="card-head">
        <div><h2>대화·답변 기록</h2><div className="hint">chat_logs와 인용된 출처, 피드백을 함께 보여 줍니다.</div></div>
        <div style={{ display: "flex", gap: 7 }}>
          {(["all", "answered", "unanswered"] as const).map(value => (
            <button key={value} className={`btn ${filter === value ? "primary" : "soft"}`} onClick={() => setFilter(value)}>
              {value === "all" ? "전체" : value === "answered" ? "답변 완료" : "미답변"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="empty">{error}</div>}
      {!error && !logs && <div className="empty">불러오는 중입니다…</div>}
      {!error && logs && !logs.length && <div className="empty">해당하는 대화 기록이 없습니다.</div>}

      {!error && logs && logs.length > 0 && (
        <div className="list">
          {logs.map(log => (
            <article className={`question ${log.isFallback ? "unanswered" : ""}`} key={log.id}>
              <div className="question-title">{log.question}</div>
              <div className="meta">
                {new Date(log.createdAt).toLocaleString("ko-KR")} · {log.userKey || "익명"}
                {log.responseMs ? ` · ${(log.responseMs / 1000).toFixed(1)}초` : ""}
                {log.isFollowup ? " · 재질문" : ""}
                {log.topSimilarity !== null ? ` · 유사도 ${log.topSimilarity.toFixed(3)}` : ""}
              </div>
              <div style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>{log.answer}</div>
              {log.citations.length > 0 && (
                <div className="citations" style={{ marginTop: 10 }}>
                  {log.citations.map((citation, index) => (
                    <span className="citation" key={`${citation.id}-${index}`}>
                      출처 {index + 1}: {citation.title}
                      {typeof citation.similarity === "number" ? ` (${Number(citation.similarity).toFixed(3)})` : ""}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 10, display: "flex", gap: 7 }}>
                <span className={`badge ${log.isFallback ? "red" : ""}`}>{log.isFallback ? "미답변" : "답변 완료"}</span>
                {log.category && <span className="badge">{log.category}</span>}
                {log.feedback && <span className={`badge ${log.feedback === "negative" ? "red" : ""}`}>
                  {log.feedback === "positive" ? "도움 됨" : "아쉬움"}
                </span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
