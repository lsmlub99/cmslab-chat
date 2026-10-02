import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { verifySlackRequest } from "./slack-auth";

const ORIGINAL_SECRET = process.env.SLACK_SIGNING_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.SLACK_SIGNING_SECRET;
  else process.env.SLACK_SIGNING_SECRET = ORIGINAL_SECRET;
});

describe("verifySlackRequest", () => {
  it("accepts a current valid Slack signature", () => {
    process.env.SLACK_SIGNING_SECRET = "test-secret";
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const timestamp = "1000";
    const signature = sign("test-secret", timestamp, body);
    const headers = new Headers({
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": signature,
    });

    expect(verifySlackRequest(headers, body, 1000)).toEqual({ ok: true, timestamp, signature });
  });

  it("rejects stale and forged requests", () => {
    process.env.SLACK_SIGNING_SECRET = "test-secret";
    const body = "{}";
    const timestamp = "1000";
    const valid = sign("test-secret", timestamp, body);

    expect(verifySlackRequest(new Headers({
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": valid,
    }), body, 1400)).toMatchObject({ ok: false, reason: "stale" });

    const forged = `${valid.slice(0, -1)}${valid.endsWith("0") ? "1" : "0"}`;
    expect(verifySlackRequest(new Headers({
      "X-Slack-Request-Timestamp": timestamp,
      "X-Slack-Signature": forged,
    }), body, 1000)).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
});

function sign(secret: string, timestamp: string, body: string) {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}
