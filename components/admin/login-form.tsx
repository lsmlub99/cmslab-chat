"use client";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";

export default function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setupRequired = params.get("setup") === "1";
  // 관리자로 지정되지 않은 계정으로 접근한 경우입니다.
  const forbidden = params.get("error") === "forbidden";
  const next = params.get("next") || "/admin";

  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "로그인하지 못했습니다.");
      // 서버 컴포넌트 캐시를 비워야 미들웨어가 새 쿠키를 보고 통과시킵니다.
      router.refresh();
      router.replace(next.startsWith("/admin") ? next : "/admin");
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "로그인하지 못했습니다.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="card login-card">
        <div className="login-mark"><Lock size={20}/></div>
        <h1 className="login-title">관리자 로그인</h1>
        <p className="hint">지식 문서와 챗봇 설정을 관리하려면 비밀번호가 필요합니다.</p>

        {forbidden ? (
          <>
            <div className="login-error" style={{ marginTop: 18 }}>
              현재 로그인한 계정에는 관리자 권한이 없습니다.
              <br/>
              관리자 계정으로 로그인하거나 담당자에게 권한을 요청해 주세요.
            </div>
            <button className="btn soft login-back" onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
              location.href = "/login?next=%2Fadmin";
            }}>
              다른 계정으로 로그인
            </button>
          </>
        ) : setupRequired ? (
          <div className="notice" style={{ marginTop: 18 }}>
            아직 관리자 비밀번호가 설정되지 않았습니다.
            <br/>
            <code>.env.local</code>에 <code>ADMIN_PASSWORD=원하는비밀번호</code>를 추가하고 개발 서버를 다시 시작해 주세요.
          </div>
        ) : (
          <form onSubmit={submit} style={{ marginTop: 20 }}>
            <div className="field">
              <label htmlFor="admin-password">비밀번호</label>
              <input
                id="admin-password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={event => setPassword(event.target.value)}
                placeholder="관리자 비밀번호"
              />
            </div>
            {error && <div className="login-error">{error}</div>}
            <button className="btn primary login-submit" disabled={busy || !password}>
              {busy ? "확인 중…" : "로그인"}
            </button>
          </form>
        )}

        <button className="btn soft login-back" onClick={() => { location.href = "/"; }}>
          사용자 채팅으로 돌아가기
        </button>
      </section>
    </div>
  );
}
