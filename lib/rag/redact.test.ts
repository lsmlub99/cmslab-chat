import { describe, expect, it } from "vitest";
import { redactSensitiveText } from "./redact";

describe("지식 문서 인증정보 마스킹", () => {
  const slackTokenLikeValue = ["xoxb", "1234567890", "abcdefghijklmnop"].join("-");

  it.each([
    "비밀번호: sample-secret-123",
    "암호 = example-pass",
    "password: sample-password",
    "postgresql://account:secret@example.com:5432/db",
    slackTokenLikeValue,
    "sk-proj-abcdefghijklmnopqrstuvwxyz123456",
  ])("인증정보를 모델에 전달하지 않는다: %s", value => {
    const redacted = redactSensitiveText(value);
    expect(redacted).toContain("[보안상 비공개]");
    expect(redacted).not.toContain("sample-secret-123");
    expect(redacted).not.toContain("example-pass");
    expect(redacted).not.toContain("sample-password");
    expect(redacted).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });

  it("일반적인 비밀번호 변경 안내는 유지한다", () => {
    expect(redactSensitiveText("비밀번호 초기화 메뉴에서 변경하세요."))
      .toBe("비밀번호 초기화 메뉴에서 변경하세요.");
  });
});
