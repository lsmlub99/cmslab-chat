import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "답봇 | 반복 질문 지식베이스",
  description: "팀의 반복 질문을 지식으로 쌓고 근거와 함께 답하는 챗봇",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
