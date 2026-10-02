import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export type SlackRequestVerification =
  | { ok: true; timestamp: string; signature: string }
  | { ok: false; reason: "not_configured" | "missing_headers" | "stale" | "invalid_signature" };

/** Slack이 보낸 원문 요청인지 HMAC-SHA256 서명과 5분 재생 방지 창으로 확인합니다. */
export function verifySlackRequest(
  headers: Headers,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): SlackRequestVerification {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!secret) return { ok: false, reason: "not_configured" };

  const timestamp = headers.get("x-slack-request-timestamp")?.trim() ?? "";
  const signature = headers.get("x-slack-signature")?.trim() ?? "";
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) {
    return { ok: false, reason: "missing_headers" };
  }

  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: "stale" };
  }

  const expected = `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody}`, "utf8")
    .digest("hex")}`;

  const givenBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (givenBytes.length !== expectedBytes.length || !timingSafeEqual(givenBytes, expectedBytes)) {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true, timestamp, signature };
}
