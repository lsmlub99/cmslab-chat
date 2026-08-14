import type { NextConfig } from "next";

/**
 * 산출물 폴더는 기본값(.next)을 씁니다.
 *
 * 예전에는 dev 와 build 산출물이 섞이지 않도록 .next-dev / .next-build 로 나눴는데,
 * 표준을 벗어나면 주변 도구가 전부 걸립니다. Vercel 은 .next 를 전제로 빌드를
 * 집어가고, 교육 과정 사용기록 검사기도 .next 만 검사 대상에서 제외합니다
 * (.next-build 안의 번들을 소스로 오해해 검사가 실패했습니다).
 * 기본값을 따르는 편이 문제를 만들지 않습니다.
 */
const nextConfig: NextConfig = {
  experimental: { serverActions: { bodySizeLimit: "20mb" } },
  async headers() {
    return [
      {
        // 사내 지식이 검색엔진에 색인되지 않게 합니다.
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
