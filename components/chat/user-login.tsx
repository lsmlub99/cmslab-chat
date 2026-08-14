"use client";
import { useSearchParams } from "next/navigation";

const MESSAGES: Record<string, string> = {
  domain: "회사 계정으로만 로그인할 수 있습니다. 다른 계정으로 시도하신 것 같습니다.",
  cancelled: "로그인이 취소되었습니다.",
  state: "로그인 요청이 만료되었거나 올바르지 않습니다. 다시 시도해 주세요.",
  expired: "로그인 요청이 만료되었습니다. 다시 시도해 주세요.",
  invalid: "로그인 정보를 확인하지 못했습니다. 다시 시도해 주세요.",
  setup: "구글 로그인이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.",
};

export default function UserLogin({
  botName,
  teamName,
  domains,
  configured,
}: {
  botName: string;
  teamName: string;
  domains: string[];
  configured: boolean;
}) {
  const params = useSearchParams();
  const error = params.get("error");
  const next = params.get("next") || "/";
  const loginHref = `/api/auth/login?next=${encodeURIComponent(next.startsWith("/") ? next : "/")}`;

  return (
    <div className="login-page">
      <section className="card login-card">
        <div className="login-mark">{botName.slice(0, 1)}</div>
        <h1 className="login-title">{botName}</h1>
        <p className="hint">{teamName}의 업무 질문에 답하는 사내 챗봇입니다.</p>

        {error && <div className="login-error">{MESSAGES[error] ?? "로그인하지 못했습니다."}</div>}

        {configured ? (
          <>
            <a className="google-btn" href={loginHref}>
              <GoogleMark/>
              회사 구글 계정으로 로그인
            </a>
            {domains.length > 0 && (
              <p className="hint" style={{ marginTop: 12 }}>
                {domains.map(domain => `@${domain}`).join(", ")} 계정만 이용할 수 있습니다.
              </p>
            )}
          </>
        ) : (
          <div className="notice" style={{ marginTop: 18, textAlign: "left" }}>
            구글 로그인이 설정되지 않았습니다.
            <br/>
            <code>GOOGLE_CLIENT_ID</code>와 <code>GOOGLE_CLIENT_SECRET</code>을 환경변수에 넣어 주세요.
          </div>
        )}
      </section>
    </div>
  );
}

/** 구글 브랜드 가이드의 4색 마크입니다. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.2-3.9 6.6-9.6 6.6-17z"/>
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C1 16.3 0 20 0 24s1 7.7 2.6 10.8l7.8-6.1z"/>
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.6 2.2-8.7 2.2-6.4 0-11.7-3.7-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/>
    </svg>
  );
}
