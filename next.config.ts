import type { NextConfig } from "next";

/**
 * distDir 주의:
 * 로컬에서는 dev 와 build 산출물이 서로 덮어쓰지 않도록 폴더를 나눠 씁니다.
 * 그런데 Vercel 은 기본 산출물 경로(.next)를 전제로 빌드를 집어가므로,
 * Vercel 환경에서는 반드시 기본값을 써야 배포가 깨지지 않습니다.
 */
function distDir() {
  if (process.env.NEXT_DIST_DIR) return process.env.NEXT_DIST_DIR;
  if (process.env.VERCEL) return ".next";
  return process.env.NODE_ENV === "development" ? ".next-dev" : ".next-build";
}

const nextConfig: NextConfig = {
  distDir: distDir(),
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  async headers() {
    return [
      {
        // 사내 지식이 검색엔진에 색인되지 않게 합니다.
        // 접근 제한(Google OAuth)이 붙기 전까지는 특히 중요합니다.
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
