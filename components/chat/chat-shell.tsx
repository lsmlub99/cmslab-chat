"use client";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LogOut, MessageSquarePlus, Settings2, Square, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import type { Citation, ConversationSummary, ConversationTurn } from "@/lib/types";
import MessageText from "@/components/chat/message-text";

type DocLink = { url: string; title: string };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  /** 근거 문서에서 뽑은 링크. 모델이 받아쓴 주소는 잘릴 수 있어 쓰지 않습니다. */
  links?: DocLink[];
  questionId?: number;
  unanswered?: boolean;
  error?: boolean;
};

type Settings = { bot_name: string; team_name: string; welcome_message: string };
type SessionUser = { name: string; email: string; picture?: string };
type BootstrapData = {
  settings: Settings;
  user: SessionUser | null;
  conversations: ConversationSummary[];
  suggestions: string[];
};

/** 마지막으로 보던 대화를 기억해 두었다가 새로고침 후 복원합니다. */
const LAST_CONVERSATION_KEY = "answerbot:last-conversation";

export default function ChatShell() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Record<number, string>>({});
  const [settings, setSettings] = useState<Settings>();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // 팀에서 실제로 많이 물어보고 답변에 성공한 질문으로 채워집니다.
  // 지어낸 예시보다 실제로 답이 나오는 질문을 보여 주는 편이 낫습니다.
  const [suggestions, setSuggestions] = useState<string[]>([
    "연차 휴가는 어떻게 신청하나요?",
    "경조사 지원금 얼마 나와요?",
    "노트북이 고장났는데 어디에 요청하나요?",
    "재직증명서는 어디서 발급받나요?",
  ]);
  // 복원할 지난 대화가 있을 때만 기다립니다.
  // 그렇지 않으면 인사말과 추천 질문을 즉시 보여 줘야 합니다 —
  // 서버가 잠들어 있을 때 API를 기다리느라 빈 화면을 보여 줄 이유가 없습니다.
  const [restoring, setRestoring] = useState(
    () => typeof window !== "undefined" && Boolean(window.localStorage.getItem(LAST_CONVERSATION_KEY)),
  );

  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController>(null);

  const botName = settings?.bot_name || "답봇";
  const welcome = settings?.welcome_message || "안녕하세요. 팀 지식에서 근거를 찾아 답해드릴게요.";

  const loadSidebar = useCallback(async () => {
    const data = await fetchJson<BootstrapData>("/api/bootstrap", 2);
    if (!data) {
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    if (data.settings) setSettings(data.settings);
    if (Array.isArray(data.conversations)) setConversations(data.conversations);
    if (Array.isArray(data.suggestions) && data.suggestions.length) setSuggestions(data.suggestions);
    setUser(data.user ?? null);
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
    const last = window.localStorage.getItem(LAST_CONVERSATION_KEY);
    // 지난 대화 복원과 설정 조회는 서로 기다릴 필요가 없습니다.
    if (last) void openConversation(last).finally(() => setRestoring(false));
    void loadSidebar();
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
    if (inputRef.current) inputRef.current.style.height = "auto";

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
        // 차단된 질문은 대화로 이어지지 않으므로 대화 번호를 기억하지 않습니다.
        if (data.conversationId && !data.blocked) rememberConversation(data.conversationId);
        updateLast({
          content: data.answer || data.error || "질문을 처리하지 못했습니다.",
          citations: data.citations || [],
          questionId: data.questionId,
          unanswered: Boolean(data.unanswered),
          error: !response.ok || Boolean(data.blocked),
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
          content: message.content ? `${message.content}\n\n(답변을 중단했습니다.)` : "답변을 중단했습니다.",
        }));
      } else {
        updateLast({
          content: error instanceof Error ? error.message : "네트워크 오류가 발생했습니다.",
          citations: [],
          error: true,
        });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
      inputRef.current?.focus();
      void loadSidebar();
    }
  }

  function handlePacket(packet: string) {
    const event = packet.match(/^event:\s*(.+)$/m)?.[1];
    const raw = packet.match(/^data:\s*([\s\S]+)$/m)?.[1];
    if (!event || !raw) return;

    let data: Record<string, unknown>;
    try { data = JSON.parse(raw); } catch { return; }

    if (event === "meta") {
      if (typeof data.conversationId === "string") rememberConversation(data.conversationId);
      updateLast({ citations: (data.citations as Citation[]) || [], links: (data.links as DocLink[]) || [] });
    }
    if (event === "delta") updateLast(message => ({ content: message.content + String(data.text ?? "") }));
    if (event === "replace") updateLast({ content: String(data.text ?? "") });
    if (event === "done") {
      updateLast({
        questionId: data.questionId as number,
        citations: (data.citations as Citation[]) || [],
        links: (data.links as DocLink[]) || [],
        unanswered: Boolean(data.unanswered),
        ...(data.answer ? { content: String(data.answer) } : {}),
      });
    }
    if (event === "error") {
      updateLast({ content: String(data.message ?? "답변 생성에 실패했습니다."), citations: [], error: true });
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.localStorage.removeItem(LAST_CONVERSATION_KEY);
    location.href = "/login";
  }

  function newChat() {
    setMessages([]);
    setConversationId(undefined);
    setFeedback({});
    window.localStorage.removeItem(LAST_CONVERSATION_KEY);
    inputRef.current?.focus();
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

  /** Enter 로 보내고 Shift+Enter 로 줄바꿈합니다. 입력창은 내용에 맞춰 늘어납니다. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  function autoGrow(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }

  const empty = messages.length === 0;

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">{botName}<small>{settings?.team_name || "팀 지식 도우미"}</small></div>

        <button className="new-chat" onClick={newChat}>
          <MessageSquarePlus size={15}/> 새 대화
        </button>

        <div className="side-kicker">지난 대화</div>
        <div className="history">
          {conversations.length ? (
            conversations.map(item => (
              <div className={`history-item ${item.id === conversationId ? "active" : ""}`} key={item.id}>
                <button className="history-open" onClick={() => openConversation(item.id)} title={item.title}>
                  <span className="history-title">{item.title}</span>
                  <span className="history-meta">{formatWhen(item.lastMessageAt)} · {item.turns}개 질문</span>
                </button>
                <button className="history-delete" onClick={() => removeConversation(item.id)} aria-label="대화 삭제">
                  <Trash2 size={12}/>
                </button>
              </div>
            ))
          ) : (
            <div className="history-empty">아직 대화가 없습니다.</div>
          )}
        </div>

        <div className="side-bottom">
          {user && (
            <div className="side-user">
              <span className="side-user-avatar">{user.name.slice(0, 1)}</span>
              <span className="side-user-name" title={user.email}>{user.name}</span>
              <button className="side-user-out" onClick={logout} aria-label="로그아웃">
                <LogOut size={13}/>
              </button>
            </div>
          )}
          <button className="side-admin" onClick={() => { location.href = "/admin"; }}>
            <Settings2 size={13}/> 관리자
          </button>
        </div>
      </aside>

      <main className="chat-main">
        <header className="chat-top">
          <div>
            <h1 className="chat-title">{botName}</h1>
            <div className="hint">등록된 팀 지식에서 근거를 찾아 답합니다.</div>
          </div>
          <span className="status">● 연결됨</span>
        </header>

        {loadFailed && (
          <div className="notice">
            연결이 불안정합니다. 질문은 계속 하실 수 있습니다.
            <button className="btn soft" style={{ marginLeft: 10 }} onClick={() => { setLoadFailed(false); void loadSidebar(); }}>
              다시 시도
            </button>
          </div>
        )}

        <div className="messages" ref={messagesRef}>
          {restoring ? (
            <div className="chat-empty"><span className="hint">불러오는 중입니다…</span></div>
          ) : empty ? (
            <div className="chat-empty">
              <div className="welcome-mark">{botName.slice(0, 1)}</div>
              <h2 className="welcome-title">
                {user ? `${user.name}님, ${welcome}` : welcome}
              </h2>
              <p className="hint">
                {conversations.length > 0
                  ? "이어서 물어보시거나, 왼쪽에서 지난 대화를 다시 열 수 있습니다."
                  : "복리후생, 인사행정, IT 지원처럼 업무와 관련된 질문을 입력해 보세요."}
              </p>
              <div className="suggestions">
                {suggestions.map(item => (
                  <button className="suggestion" key={item} onClick={() => { setQuestion(item); inputRef.current?.focus(); }}>
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <article className={`message ${message.role === "user" ? "me" : ""}`} key={message.id}>
                {message.role === "assistant" && <span className="bot">{botName.slice(0, 1)}</span>}
                <div className={`bubble ${message.error ? "bubble-error" : ""}`}>
                  {message.content ? (
                    <MessageText text={message.content}/>
                  ) : loading && index === messages.length - 1 ? (
                    <Thinking/>
                  ) : (
                    <span className="hint">…</span>
                  )}

                  {Boolean(message.links?.length) && (
                    <div className="doc-links">
                      <span className="doc-links-label">관련 문서</span>
                      {message.links?.map(link => (
                        <a className="doc-link" key={link.url} href={link.url} target="_blank" rel="noreferrer">
                          <ExternalLink size={11}/> {link.title}
                        </a>
                      ))}
                    </div>
                  )}

                  {message.unanswered && (
                    <div className="handoff">
                      관리자에게 전달했습니다. 지식으로 등록되면 다음부터 바로 답변합니다.
                    </div>
                  )}

                  {Boolean(message.citations?.length) && (
                    <div className="citations">
                      {message.citations?.map((citation, position) => (
                        citation.sourceUrl ? (
                          <a className="citation" key={`${citation.id}-${position}`} href={citation.sourceUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={11}/> {citation.title}
                          </a>
                        ) : (
                          <span className="citation" key={`${citation.id}-${position}`}>{citation.title}</span>
                        )
                      ))}
                    </div>
                  )}

                  {message.role === "assistant" && message.content && !message.error && (
                    <div className="message-actions">
                      <CopyButton text={message.content}/>
                      {message.questionId && !message.unanswered && (
                        <>
                          <button
                            className={`action ${feedback[message.questionId] === "positive" ? "on" : ""}`}
                            onClick={() => rate(message.questionId!, "positive")}
                            aria-label="도움이 됐어요"
                          >
                            <ThumbsUp size={13}/>
                          </button>
                          <button
                            className={`action ${feedback[message.questionId] === "negative" ? "on" : ""}`}
                            onClick={() => rate(message.questionId!, "negative")}
                            aria-label="아쉬워요"
                          >
                            <ThumbsDown size={13}/>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
        </div>

        <form className="composer" onSubmit={submit}>
          <textarea
            ref={inputRef}
            rows={1}
            value={question}
            onChange={event => { setQuestion(event.target.value); autoGrow(event.target); }}
            onKeyDown={onKeyDown}
            placeholder="업무 질문을 입력해 주세요.  (Enter 전송 · Shift+Enter 줄바꿈)"
            aria-label="질문 입력"
          />
          {loading ? (
            <button type="button" className="btn soft" onClick={stop}><Square size={11}/> 중단</button>
          ) : (
            <button className="btn primary" disabled={!question.trim()}>보내기</button>
          )}
        </form>
      </main>
    </div>
  );
}

function Thinking() {
  return (
    <span className="thinking" aria-label="답변 생성 중">
      <i/><i/><i/>
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 클립보드 권한이 없는 브라우저 — 조용히 넘어갑니다.
    }
  }

  return (
    <button className={`action ${copied ? "on" : ""}`} onClick={copy} aria-label="답변 복사">
      {copied ? <Check size={13}/> : <Copy size={13}/>}
    </button>
  );
}

/**
 * 실패하면 잠깐 쉬었다 다시 시도합니다.
 * Vercel 함수가 잠들어 있으면 첫 요청이 시간 초과로 죽는 일이 있는데,
 * 그때 화면이 빈 채로 남지 않도록 한 번 더 두드립니다.
 */
async function fetchJson<T>(url: string, retries = 0): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (!data || !(data as { error?: string }).error) return data as T;
      }
    } catch {
      // 네트워크 오류 — 아래에서 재시도합니다.
    }
    if (attempt < retries) await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  return null;
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
