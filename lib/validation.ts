import { z } from "zod";

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
});

export const feedbackSchema = z.object({
  questionId: z.coerce.number().int().positive(),
  rating: z.enum(["positive", "negative"]),
  note: z.string().trim().max(1000).optional(),
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
});
