export type Citation = {
  id: number;
  title: string;
  sourceUrl?: string | null;
  page?: number | null;
  similarity?: number;
};

export type KnowledgeStatus = "processing" | "ready" | "error";

export type KnowledgeDocument = {
  id: number;
  title: string;
  category: string | null;
  file_type: string;
  status: KnowledgeStatus;
  error_message?: string | null;
  reuse_count: number;
  created_at: string;
  updated_at: string;
  chunks: number;
  /** 임베딩이 채워진 청크 수. chunks 보다 적으면 벡터 검색이 반쪽만 됩니다. */
  embedded?: number;
  source_hash?: string;
};

export type DashboardTotals = {
  questions: number;
  followups: number;
  /** 로그인 계정 기준 실제 사용자 수. 성과 지표에 쓰는 값입니다. */
  users: number;
  /** 로그인 전 익명 쿠키까지 포함한 수. 참고용입니다. */
  visitors: number;
  /** 로그인 도입 전에 쌓인 질문 수. */
  anonymousQuestions: number;
  answeredRate: number;
  unansweredRate: number;
  reuse: number;
  citationRate: number;
  avgResponseMs: number;
  avgSimilarity: number;
  satisfaction: number | null;
  feedbackCount: number;
  pending: number;
  /** 욕설·비방으로 차단된 질문 수. 지표에는 포함하지 않습니다. */
  blocked: number;
  documents: number;
  chunks: number;
  embedded: number;
};

export type DashboardData = {
  range?: { from: string; to: string };
  totals: DashboardTotals;
  series: { date: string; label: string; questions: number; answered: number }[];
  topics: { category: string; questions: number; answered: number }[];
  people: { name: string; email: string; questions: number; answered: number; lastAt: string }[];
};

export type UnansweredQuestion = {
  id: number;
  question: string;
  created_at: string;
  /** 로그인 사용자면 이름, 아니면 "익명 xxxxxx". */
  user_key: string | null;
  user_email: string | null;
  top_similarity: number | null;
};

export type ConversationSummary = {
  id: string;
  title: string;
  turns: number;
  lastMessageAt: string;
  hasUnanswered: boolean;
};

export type ConversationTurn = {
  id: number;
  question: string;
  answer: string;
  isFallback: boolean;
  createdAt: string;
  citations: Citation[];
};

export type ConversationLog = {
  id: number;
  question: string;
  answer: string;
  category: string | null;
  isFallback: boolean;
  isFollowup: boolean;
  responseMs: number | null;
  citationCount: number;
  topSimilarity: number | null;
  conversationId: string | null;
  userKey: string | null;
  createdAt: string;
  feedback: "positive" | "negative" | null;
  citations: Citation[];
};
