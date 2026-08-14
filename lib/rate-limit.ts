import { database, hasDatabaseConfig } from "@/lib/database";

/**
 * 속도 제한.
 *
 * 실수나 장난으로 질문이 연발되어 OpenAI 과금이 튀는 것을 막습니다.
 *
 * 왜 DB에 세는가: Vercel 같은 서버리스에서는 요청마다 다른 인스턴스가 뜰 수 있고
 * 인스턴스끼리 메모리를 공유하지 않습니다. 메모리에 세면 인스턴스 수만큼 제한이
 * 느슨해져 사실상 무력해집니다. 그래서 공용 저장소(PostgreSQL)에 셉니다.
 * DB를 못 쓰는 상황에서는 메모리 카운터로 물러섭니다(없는 것보다는 낫습니다).
 */

export type RateLimitResult = {
  allowed: boolean;
  /** 다시 시도할 수 있을 때까지 남은 초. */
  retryAfter: number;
  remaining: number;
};

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  if (hasDatabaseConfig()) {
    try {
      const rows = await database()`
        select hits, window_start from public.bump_rate_limit(${key}, ${windowSeconds})
      `;
      const hits = Number(rows[0].hits);
      const windowStart = new Date(rows[0].window_start as string).getTime();
      const elapsed = Math.floor((Date.now() - windowStart) / 1000);
      const retryAfter = Math.max(1, windowSeconds - elapsed);

      return hits > limit
        ? { allowed: false, retryAfter, remaining: 0 }
        : { allowed: true, retryAfter: 0, remaining: Math.max(0, limit - hits) };
    } catch {
      // 마이그레이션 전이거나 DB가 잠시 불안정한 경우입니다. 메모리로 물러섭니다.
    }
  }
  return memoryLimit(key, limit, windowSeconds * 1000);
}

/* ── 대비책: 메모리 카운터 ─────────────────────────────────────────────────── */

const buckets = new Map<string, number[]>();

function memoryLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  // 메모리가 무한정 늘지 않도록 가끔 오래된 항목을 치웁니다.
  if (buckets.size > 500) {
    for (const [existing, hits] of buckets) {
      if (!hits.some(time => now - time < windowMs)) buckets.delete(existing);
    }
  }

  const recent = (buckets.get(key) ?? []).filter(time => now - time < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)), remaining: 0 };
  }

  recent.push(now);
  buckets.set(key, recent);
  return { allowed: true, retryAfter: 0, remaining: limit - recent.length };
}

/** 요청자를 구분할 키. 쿠키가 있으면 사용자별, 없으면 IP별로 셉니다. */
export function requesterKey(request: Request, userId?: string) {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${forwarded || request.headers.get("x-real-ip") || "local"}`;
}

function num(name: string, fallback: number) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 질문 제한: 기본 1분에 12건. */
export const CHAT_LIMIT = () => num("RATE_LIMIT_CHAT", 12);
export const CHAT_WINDOW_SECONDS = () => num("RATE_LIMIT_WINDOW_SECONDS", 60);
