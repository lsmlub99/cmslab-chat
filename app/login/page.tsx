import { Suspense } from "react";
import UserLogin from "@/components/chat/user-login";
import { getSettings } from "@/lib/settings";
import { allowedDomains, hasGoogleConfig } from "@/lib/google-auth";

export default async function LoginPage() {
  const settings = await getSettings();
  return (
    <Suspense fallback={null}>
      <UserLogin
        botName={settings.bot_name}
        teamName={settings.team_name}
        domains={allowedDomains()}
        configured={hasGoogleConfig()}
      />
    </Suspense>
  );
}
