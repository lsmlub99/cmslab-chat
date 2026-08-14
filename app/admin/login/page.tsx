import LoginForm from "@/components/admin/login-form";
import { usesEmailAdmin } from "@/lib/admin-access";

/**
 * 검색 파라미터를 서버에서 읽어 넘깁니다.
 * 클라이언트에서 읽으면 Suspense 로 감싸야 하고, 그동안 빈 화면이 보입니다.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; setup?: string; next?: string }>;
}) {
  const params = await searchParams;
  return (
    <LoginForm
      setupRequired={params.setup === "1"}
      forbidden={params.error === "forbidden"}
      next={params.next}
      emailMode={usesEmailAdmin()}
    />
  );
}
