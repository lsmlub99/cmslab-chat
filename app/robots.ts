import type { MetadataRoute } from "next";

/**
 * 사내 지식베이스라 검색엔진에 노출되면 안 됩니다.
 * next.config.ts 의 X-Robots-Tag 헤더와 함께 이중으로 막습니다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
