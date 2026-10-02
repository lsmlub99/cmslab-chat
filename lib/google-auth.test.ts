import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasAnyGoogleAuthConfig,
  hasGoogleConfig,
  isAllowedEmail,
  requiresGoogleAuth,
} from "./google-auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google 인증 설정", () => {
  it("필수 설정이 모두 있을 때만 완전한 설정으로 본다", () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "example.com");

    expect(hasAnyGoogleAuthConfig()).toBe(true);
    expect(hasGoogleConfig()).toBe(true);
  });

  it("일부만 설정된 경우에도 인증을 요구해 공개 모드로 떨어지지 않는다", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");

    expect(hasAnyGoogleAuthConfig()).toBe(true);
    expect(hasGoogleConfig()).toBe(false);
    expect(requiresGoogleAuth()).toBe(true);
  });

  it("프로덕션에서는 설정이 전혀 없어도 인증을 요구한다", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");

    expect(requiresGoogleAuth()).toBe(true);
  });
});

describe("Google Workspace 도메인 검사", () => {
  it("이메일 도메인과 hosted domain이 모두 허용 목록에 있어야 통과한다", () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "example.com, subsidiary.co.kr");

    expect(isAllowedEmail("user@example.com", "example.com")).toBe(true);
    expect(isAllowedEmail("user@example.com")).toBe(false);
    expect(isAllowedEmail("user@example.com", "other.com")).toBe(false);
    expect(isAllowedEmail("user@other.com", "example.com")).toBe(false);
  });
});
