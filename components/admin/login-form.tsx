"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

export default function LoginForm({
  setupRequired,
  forbidden,
  next,
  emailMode,
}: {
  setupRequired: boolean;
  /** 로그인은 했지만 관리자로 지정되지 않은 계정입니다. */
  forbidden: boolean;
  next?: string;
  /** ADMIN_EMAILS 로 관리자를 지정하는 방식인지. 이때는 비밀번호 입력이 없습니다. */
  emailMode: boolean;
}) {
  const router = useRouter();
  // 외부 주소로 튕기지 않도록 앱 내부 경로만 허용합니다.
  const target = next && next.startsWith("/admin") ? next : "/admin";

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
      router.replace(target);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "로그인하지 못했습니다.");
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  async function switchAccount() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    location.href = `/login?next=${encodeURIComponent(target)}`;
  }

  return (
    <div className="login-page">
      <section className="card login-card">
        <div className="login-mark"><Lock size={20}/></div>
        <h1 className="login-title">관리자</h1>
        <p className="hint">지식 문서와 성과 지표를 관리하는 화면입니다.</p>

        {forbidden ? (
          <>
            <div className="login-error" style={{ marginTop: 18 }}>
              현재 로그인한 계정에는 관리자 권한이 없습니다.
              <br/>
              관리자 계정으로 로그인하거나 담당자에게 권한을 요청해 주세요.
            </div>
            <button className="btn primary login-submit" onClick={switchAccount}>
              다른 계정으로 로그인
            </button>
          </>
        ) : setupRequired ? (
          <div className="notice" style={{ marginTop: 18, textAlign: "left" }}>
            관리자 설정이 되어 있지 않습니다. 환경변수에
            <br/>
            <code>ADMIN_EMAILS</code> 또는 <code>ADMIN_PASSWORD</code>를 넣어 주세요.
          </div>
        ) : emailMode ? (
          <>
            <div className="notice" style={{ marginTop: 18, textAlign: "left" }}>
              관리자는 계정으로 지정됩니다. 관리자 계정으로 로그인해 주세요.
            </div>
            <button className="btn primary login-submit" onClick={switchAccount}>
              다른 계정으로 로그인
            </button>
          </>
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
          챗봇으로 돌아가기
        </button>
      </section>
    </div>
  );
}
