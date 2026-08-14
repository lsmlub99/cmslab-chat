import { Suspense } from "react";
import LoginForm from "@/components/admin/login-form";

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
