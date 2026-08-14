/**
 * 관리자 권한 판정.
 *
 * 예전에는 공용 비밀번호 하나로만 관리자를 구분했습니다. 그런데 관리자 쿠키에는
 * 누가 로그인했는지가 담기지 않아서, 같은 브라우저에서 구글 계정만 바꿔도
 * 관리자 권한이 그대로 남았습니다. 실제로 다른 사람 계정으로 관리자 화면에
 * 들어가지는 상황이 확인됐습니다.
 *
 * 이제 로그인으로 사람이 누군지 알 수 있으므로, 관리자를 이메일로 지정합니다.
 * 권한이 신원에 붙으므로 계정을 바꾸면 권한도 따라 바뀝니다.
 *
 * ADMIN_EMAILS 가 없으면 예전처럼 비밀번호 방식으로 물러섭니다
 * (구글 로그인을 아직 설정하지 않은 환경을 위해서입니다).
 */

export function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map(email => email.trim().toLowerCase())
    .filter(Boolean);
}

/** 이메일로 관리자를 지정하는 방식을 쓰는지. */
export function usesEmailAdmin() {
  return adminEmails().length > 0;
}

export function isAdminEmail(email: string | undefined) {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}
