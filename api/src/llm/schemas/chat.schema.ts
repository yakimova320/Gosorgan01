import { z } from 'zod';

/** Ответ chat.v1 (чат-помощник, 24.11). */
export const ChatAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
});
export type ChatAnswer = z.infer<typeof ChatAnswerSchema>;
