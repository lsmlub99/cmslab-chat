/**
 * 더 이상 사용하지 않습니다.
 *
 * 예전에는 workspace_settings 를 supabase-js + service_role 키로 읽고 썼습니다.
 * 그런데 .env.local 의 SUPABASE_SERVICE_ROLE_KEY 가 비어 있어서 설정 저장이 항상 실패했고,
 * 나머지 기능은 모두 DATABASE_URL 로 PostgreSQL 에 직접 붙고 있었습니다.
 * 연결 경로를 하나로 합치는 편이 낫기 때문에 설정도 lib/settings.ts 에서
 * PostgreSQL 로 처리합니다.
 *
 * Supabase Storage 나 Auth 를 쓰게 되면 이 파일을 되살리고
 * .env.local 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 채우세요.
 */
export {};
