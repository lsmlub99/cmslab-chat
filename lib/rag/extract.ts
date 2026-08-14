import pdfParse from "pdf-parse";
import mammoth from "mammoth";

export async function extractText(file: Buffer, filename: string) {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    const parsed = await pdfParse(file, { pagerender: async (pageData: { getTextContent: () => Promise<{ items: { str?: string }[] }> }) => {
      const content = await pageData.getTextContent();
      return `${content.items.map(item => item.str || "").join(" ")}\n[PAGE_BREAK]\n`;
    } });
    return parsed.text;
  }
  if (ext === "docx") {
    const parsed = await mammoth.extractRawText({ buffer: file });
    return parsed.value;
  }
  if (ext === "txt" || ext === "md") return file.toString("utf8");
  throw new Error("지원하지 않는 파일 형식입니다. PDF, DOCX, TXT, MD만 업로드할 수 있습니다.");
}

export function normalizeText(text: string) {
  return text.normalize("NFKC").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
