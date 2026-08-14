"use client";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronRight, ExternalLink, MessageSquarePlus, Settings2, Square, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import type { Citation, ConversationSummary, ConversationTurn, DashboardData, UnansweredQuestion } from "@/lib/types";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  questionId?: number;
  unanswered?: boolean;
};

type Settings = { bot_name: string; team_name: string; welcome_message: string };

/** 마지막으로 보던 대화를 기억해 두었다가 새로고침 후 복원합니다. */
const LAST_CONVERSATION_KEY = "answerbot:last-conversation";

export default function ChatShell() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [settings, setSettings] = useState<Settings>();
  const [stats, setStats] = useState<DashboardData>();
  const [pending, setPending] = useState<UnansweredQuestion[]>([]);
  const messagesRef = useRef<HTMLDivElement>(null);
  // 답변 중단용. 요청을 끊으면 서버가 모델 호출도 함께 끊습니다.
  const abortRef = useRef<AbortController>(null);

  const botName = settings?.bot_name || "답봇";
  const welcome = settings?.welcome_message || "안녕하세요. 팀 지식에서 근거를 찾아 답해드릴게요.";

  const greeting = useMemo<Message>(
    () => ({
      id: "welcome",
      role: "assistant",
      content: `${welcome}\n복리후생, 인사행정, IT 지원처럼 업무와 관련된 질문을 입력해 보세요.`,
    }),
    [welcome],
  );

  const suggestions = useMemo(
    () => ["연차 휴가는 어떻게 신청하나요?", "경조사 지원금 신청 방법 알려줘", "노트북이나 계정 지원은 어디에 요청하나요?"],
    [],
  );

  const loadSidebar = useCallback(async () => {
    // 화면의 모든 수치는 실제 DB 집계입니다. 실패하면 숫자를 지어내지 않고 비워 둡니다.
    const [dashboard, unanswered, list] = await Promise.all([
      fetchJson<DashboardData>("/api/dashboard?days=7"),
      fetchJson<UnansweredQuestion[]>("/api/questions/unanswered?limit=4"),
      fetchJson<ConversationSummary[]>("/api/conversations"),
    ]);
    if (dashboard) setStats(dashboard);
    if (Array.isArray(unanswered)) setPending(unanswered);
    if (Array.isArray(list)) setConversations(list);
  }, []);

  /** 지난 대화를 화면 메시지로 되살립니다. */
  const openConversation = useCallback(async (id: string) => {
    const data = await fetchJson<{ id: string; turns: ConversationTurn[] }>(`/api/conversations/${id}`);
    if (!data?.turns?.length) {
      window.localStorage.removeItem(LAST_CONVERSATION_KEY);
      return false;
    }

    setMessages(
      data.turns.flatMap(turn => [
        { id: `q-${turn.id}`, role: "user" as const, content: turn.question },
        {
          id: `a-${turn.id}`,
          role: "assistant" as const,
          content: turn.answer,
          citations: turn.citations,
          questionId: turn.id,
          unanswered: turn.isFallback,
        },
      ]),
    );
    setConversationId(id);
    window.localStorage.setItem(LAST_CONVERSATION_KEY, id);
    return true;
  }, []);

  useEffect(() => {
    void (async () => {
      const loaded = await fetchJson<Settings>("/api/settings");
      if (loaded) setSettings(loaded);

      const last = window.localStorage.getItem(LAST_CONVERSATION_KEY);
      if (last) await openConversation(last);
      setRestoring(false);

      await loadSidebar();
    })();
  }, [loadSidebar, openConversation]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function updateLast(patch: Partial<Message> | ((message: Message) => Partial<Message>)) {
    setMessages(current =>
      current.map((message, index) =>
        index === current.length - 1 ? { ...message, ...(typeof patch === "function" ? patch(message) : patch) } : message,
      ),
    );
  }

  function rememberConversation(id: string) {
    setConversationId(id);
    window.localStorage.setItem(LAST_CONVERSATION_KEY, id);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const value = question.trim();
    if (!value || loading) return;

    setQuestion("");
    setMessages(current => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content: value },
      { id: crypto.randomUUID(), role: "assistant", content: "", citations: [] },
    ]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: value, conversationId }),
        signal: controller.signal,
      });

      // 근거를 못 찾은 경우와 설정 오류는 JSON으로 옵니다.
      if ((response.headers.get("content-type") || "").includes("application/json")) {
        const data = await response.json();
        if (data.conversationId) rememberConversation(data.conversationId);
        updateLast({
          content: data.answer || data.error || "질문을 처리하지 못했습니다.",
          citations: data.citations || [],
          questionId: data.questionId,
          unanswered: Boolean(data.unanswered),
        });
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("스트리밍 응답을 읽지 못했습니다.");

      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        buffer += decoder.decode(part.value, { stream: true });
        const packets = buffer.split("\n\n");
        buffer = packets.pop() || "";
        for (const packet of packets) handlePacket(packet);
      }
    } catch (error) {
      // 중단은 오류가 아닙니다. 여기까지 받은 답변을 그대로 두고 표시만 덧붙입니다.
      if (error instanceof DOMException && error.name === "AbortError") {
        updateLast(message => ({
          content: message.content
            ? `${message.content}\n\n(답변을 중단했습니다.)`
            : "답변을 중단했습니다.",
        }));
      } else {
        updateLast({ content: error instanceof Error ? error.message : "네트워크 오류가 발생했습니다.", citations: [] });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      void loadSidebar();
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function handlePacket(packet: string) {
    const event = packet.match(/^event:\s*(.+)$/m)?.[1];
    const raw = packet.match(/^data:\s*([\s\S]+)$/m)?.[1];
    if (!event || !raw) return;

    let data: Record<string, unknown>;
    try { data = JSON.parse(raw); } catch { return; }

    if (event === "meta") {
      if (typeof data.conversationId === "string") rememberConversation(data.conversationId);
      updateLast({ citations: (data.citations as Citation[]) || [] });
    }
    if (event === "delta") {
      updateLast(message => ({ content: message.content + String(data.text ?? "") }));
    }
    if (event === "replace") {
      updateLast({ content: String(data.text ?? "") });
    }
    if (event === "done") {
      updateLast({
        questionId: data.questionId as number,
        citations: (data.citations as Citation[]) || [],
        unanswered: Boolean(data.unanswered),
        ...(data.answer ? { content: String(data.answer) } : {}),
      });
    }
    if (event === "error") {
      updateLast({ content: String(data.message ?? "답변 생성에 실패했습니다."), citations: [] });
    }
  }

  function newChat() {
    setMessages([]);
    setConversationId(undefined);
    setFeedback({});
    window.localStorage.removeItem(LAST_CONVERSATION_KEY);
  }

  async function removeConversation(id: string) {
    if (!confirm("이 대화 기록을 삭제할까요?")) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => undefined);
    if (id === conversationId) newChat();
    void loadSidebar();
  }

  async function rate(questionId: number, rating: "positive" | "negative") {
    setFeedback(current => ({ ...current, [questionId]: rating }));
    await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, rating }),
    }).catch(() => undefined);
  }

  const totals = stats?.totals;
  const shown = messages.length ? messages : [greeting];

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">{botName}<small>반복 질문 지식베이스</small></div>
        <div className="side-kicker">TEAM CHAT</div>
        <nav className="nav">
          <button className="active"><Bot size={16}/> 질문 답변</button>
          <button onClick={newChat}><MessageSquarePlus size={16}/> 새 대화</button>
          <button onClick={() => { location.href = "/admin"; }}><Settings2 size={16}/> 관리자 페이지</button>
        </nav>

        {conversations.length > 0 && (
          <div className="history">
            <div className="side-kicker">지난 대화</div>
            {conversations.map(item => (
              <div className={`history-item ${item.id === conversationId ? "active" : ""}`} key={item.id}>
                <button className="history-open" onClick={() => openConversation(item.id)} title={item.title}>
                  <span className="history-title">{item.title}</span>
                  <span className="history-meta">
                    {formatWhen(item.lastMessageAt)} · {item.turns}턴{item.hasUnanswered ? " · 미답변" : ""}
                  </span>
                </button>
                <button className="history-delete" onClick={() => removeConversation(item.id)} aria-label="대화 삭제">
                  <Trash2 size={12}/>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="side-foot">팀 지식이 쌓일수록<br/>답변은 더 빨라집니다.</div>
      </aside>

      <main className="shell">
        <header className="top">
          <div>
            <div className="eyebrow">TEAM KNOWLEDGE BASE</div>
            <h1 className="title">무엇이든 물어보세요</h1>
          </div>
          <div className="person">
            <span>{totals ? `등록 지식 ${totals.documents}건 · ${totals.chunks}개 청크` : "지식 현황 확인 중"}</span>
            <span className="avatar">{botName.slice(0, 1)}</span>
          </div>
        </header>

        <section className="stats">
          <Stat label="최근 7일 질문" value={totals ? `${totals.questions}건` : "—"} note={totals ? `재질문 ${totals.followups}건` : "집계 준비 중"}/>
          <Stat label="답변 완료율" value={totals ? `${totals.answeredRate}%` : "—"} note={totals ? `미답변 ${totals.unansweredRate}%` : "집계 준비 중"}/>
          <Stat label="지식 재사용" value={totals ? `${totals.reuse}회` : "—"} note="답변에 인용된 누적 횟수"/>
          <Stat label="미답변 대기" value={totals ? `${totals.pending}건` : "—"} note={totals?.pending ? "관리자 확인 필요" : "대기 중인 질문 없음"}/>
        </section>

        <div className="chat-grid">
          <section className="card chat-card">
            <div className="card-head">
              <div>
                <h2>{botName}과 대화하기</h2>
                <div className="hint">
                  {conversationId ? "이어지는 질문은 앞선 대화를 참고해 답변합니다." : "등록된 팀 지식을 검색하고 근거와 함께 답변합니다."}
                </div>
              </div>
              <span className="status">● 연결됨</span>
            </div>

            <div className="messages" ref={messagesRef}>
              {restoring ? (
                <div className="hint" style={{ padding: 16 }}>지난 대화를 불러오는 중입니다…</div>
              ) : shown.map(message => (
                <article className={`message ${message.role === "user" ? "me" : ""}`} key={message.id}>
                  {message.role === "assistant" && <span className="bot">봇</span>}
                  <div className="bubble">
                    {message.content
                      ? <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>
                      : <span className="hint">답변을 찾고 있습니다…</span>}

                    {Boolean(message.citations?.length) && (
                      <div className="citations">
                        {message.citations?.map((citation, index) => (
                          citation.sourceUrl ? (
                            <a className="citation" key={`${citation.id}-${index}`} href={citation.sourceUrl} target="_blank" rel="noreferrer">
                              <ExternalLink size={11}/> 출처 {index + 1}: {citation.title}
                              {citation.page ? ` · ${citation.page}쪽` : ""}
                            </a>
                          ) : (
                            <span className="citation" key={`${citation.id}-${index}`}>
                              출처 {index + 1}: {citation.title}{citation.page ? ` · ${citation.page}쪽` : ""}
                            </span>
                          )
                        ))}
                      </div>
                    )}

                    {message.questionId && !message.unanswered && (
                      <div className="citations">
                        <button className="citation" onClick={() => rate(message.questionId!, "positive")}>
                          <ThumbsUp size={12}/> {feedback[message.questionId] === "positive" ? "도움이 됐어요" : "도움이 됐나요?"}
                        </button>
                        <button className="citation" onClick={() => rate(message.questionId!, "negative")}>
                          <ThumbsDown size={12}/> {feedback[message.questionId] === "negative" ? "개선 요청됨" : "아쉬워요"}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>

            <div className="suggestions">
              {suggestions.map(item => (
                <button className="btn soft" key={item} onClick={() => setQuestion(item)}>{item}<ChevronRight size={14}/></button>
              ))}
            </div>

            <form className="composer" onSubmit={submit}>
              <input
                value={question}
                onChange={event => setQuestion(event.target.value)}
                placeholder="업무 질문을 입력해 주세요"
                aria-label="질문 입력"
                disabled={loading}
              />
              {loading ? (
                <button type="button" className="btn soft" onClick={stop}>
                  <Square size={11}/> 중단
                </button>
              ) : (
                <button className="btn primary" disabled={!question.trim()}>질문 보내기</button>
              )}
            </form>
          </section>

          <aside className="card">
            <div className="card-head">
              <div>
                <h2>최근 미답변 질문</h2>
                <div className="hint">관리자가 확인하고 지식으로 등록합니다.</div>
              </div>
              <span className={`badge ${pending.length ? "red" : ""}`}>{pending.length}건</span>
            </div>

            {pending.length ? (
              <div className="list">
                {pending.map(item => (
                  <div className="question unanswered" key={item.id}>
                    <div className="question-title">{item.question}</div>
                    <div className="meta">{formatWhen(item.created_at)} · {item.user_key || "익명"}</div>
                    <span className="badge red">미답변</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">아직 미답변 질문이 없습니다.</div>
            )}

            <div className="topic">
              <div className="card-head">
                <div>
                  <h2>자주 묻는 주제</h2>
                  <div className="hint">최근 7일</div>
                </div>
              </div>
              {stats?.topics?.length ? (
                <div>
                  {stats.topics.map(topic => (
                    <div className="topic-row" key={topic.category}>
                      <b>{topic.category}</b>
                      <span>{topic.questions}건 · 답변 {topic.answered}건</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty">최근 7일 질문 기록이 없습니다.</div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="stat"><label>{label}</label><strong>{value}</strong><span className="up">{note}</span></div>;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data && (data as { error?: string }).error ? null : (data as T);
  } catch {
    return null;
  }
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60_000) return "방금";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}시간 전`;
  return date.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
}
