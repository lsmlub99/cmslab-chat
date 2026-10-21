import { z } from "zod";

const optionalDate = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다."),
  z.literal(""),
]).optional();

const governanceFields = {
  owner: z.string().trim().max(100).optional(),
  effectiveDate: optionalDate,
  expiresAt: optionalDate,
  authority: z.enum(["official", "reference", "draft"]).default("reference"),
  priority: z.coerce.number().int().min(0).max(100).default(50),
};

export const chatSchema = z.object({
  question: z.string().trim().min(1, "질문을 입력해 주세요.").max(2000),
  conversationId: z.string().uuid().optional(),
  userId: z.string().trim().max(200).optional(),
});

export const textKnowledgeSchema = z.object({
  title: z.string().trim().min(1, "문서 제목을 입력해 주세요.").max(200),
  category: z.string().trim().max(80).default("일반"),
  body: z.string().trim().min(20, "본문은 20자 이상 입력해 주세요.").max(500_000),
  sourceLabel: z.string().trim().max(200).optional(),
  // 빈 문자열은 "입력 안 함"으로 취급합니다(폼에서 빈 값이 그대로 넘어옵니다).
  sourceUrl: z.union([z.string().url("올바른 URL을 입력해 주세요."), z.literal("")]).optional(),
  ...governanceFields,
});

export const feedbackSchema = z.object({
  questionId: z.coerce.number().int().positive(),
  rating: z.enum(["positive", "negative"]),
  note: z.string().trim().max(1000).optional(),
  reason: z.enum(["incorrect", "outdated", "irrelevant", "insufficient", "source_issue"]).optional(),
}).superRefine((value, context) => {
  if (value.rating === "negative" && !value.reason) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "아쉬운 이유를 선택해 주세요." });
  }
});

export const answerQuestionSchema = z.object({
  answer: z.string().trim().min(20, "답변은 20자 이상 입력해 주세요.").max(500_000),
  category: z.string().trim().max(80).optional(),
  sourceLabel: z.string().trim().max(200).optional(),
  sourceUrl: z.union([z.string().url("올바른 URL을 입력해 주세요."), z.literal("")]).optional(),
});

export const editKnowledgeSchema = z.object({
  title: z.string().trim().max(200).optional(),
  category: z.string().trim().max(80).optional(),
  body: z.string().trim().min(20, "본문은 20자 이상 입력해 주세요.").max(500_000),
  sourceLabel: z.string().trim().max(200).optional(),
  sourceUrl: z.union([z.string().url("올바른 URL을 입력해 주세요."), z.literal("")]).optional(),
  ...governanceFields,
});
