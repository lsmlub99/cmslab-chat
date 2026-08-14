import UserLogin from "@/components/chat/user-login";
import { getSettings } from "@/lib/settings";
import { allowedDomains, hasGoogleConfig } from "@/lib/google-auth";

/**
 * 로그인 화면은 서버에서 완성해 내려보냅니다.
 * 예전에는 클라이언트에서 useSearchParams 로 오류 코드를 읽느라 Suspense 로 감쌌고,
 * 그동안 빈 화면이 잠깐 보였습니다. 검색 파라미터를 서버에서 받으면 그럴 일이 없습니다.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const [settings, params] = await Promise.all([getSettings(), searchParams]);

  return (
    <UserLogin
      botName={settings.bot_name}
      teamName={settings.team_name}
      domains={allowedDomains()}
      configured={hasGoogleConfig()}
      error={params.error}
      next={params.next}
    />
  );
}
