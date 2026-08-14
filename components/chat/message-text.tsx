"use client";
import { splitLinks } from "@/lib/rag/links";

/**
 * 답변 본문을 그립니다.
 * 줄바꿈은 그대로 유지하고, 본문 속 URL만 클릭 가능한 링크로 바꿉니다.
 */
export default function MessageText({ text }: { text: string }) {
  return (
    <span className="message-text">
      {splitLinks(text).map((piece, index) =>
        piece.href ? (
          <a key={index} href={piece.href} target="_blank" rel="noreferrer" className="inline-link">
            {piece.text}
          </a>
        ) : (
          <span key={index}>{piece.text}</span>
        ),
      )}
    </span>
  );
}
