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
  users: number;
  answeredRate: number;
  unansweredRate: number;
  reuse: number;
  citationRate: number;
  avgResponseMs: number;
  avgSimilarity: number;
  satisfaction: number | null;
  feedbackCount: number;
  pending: number;
  documents: number;
  chunks: number;
  embedded: number;
};

export type DashboardData = {
  range?: { from: string; to: string };
  totals: DashboardTotals;
  series: { date: string; label: string; questions: number; answered: number }[];
  topics: { category: string; questions: number; answered: number }[];
};

export type UnansweredQuestion = {
  id: number;
  question: string;
  created_at: string;
  user_key: string | null;
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
