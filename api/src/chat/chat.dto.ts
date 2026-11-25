import { z } from 'zod';

/** Пометка под каждым ответом чата: ставит код, не модель (решение 24.11). */
export const CHAT_DISCLAIMER =
  'Это не юридическая консультация. Ja!sno может ошибаться: важное проверьте в ведомстве или на консультации.';

/** Сколько последних сообщений отдаёт GET /chat. */
export const CHAT_HISTORY_LIMIT = 100;

export const AskSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, { message: 'Напишите вопрос' })
      .max(1000, { message: 'Не больше 1000 знаков' }),
  })
  .strict();
export type AskInput = z.infer<typeof AskSchema>;

/**
 * KORR 25.11: чат на главной без входа. Ничего не сохраняется: прошлые реплики присылает сайт
 * (до 6, каждая до 1000 знаков). Ответ модели — как в кабинете, тот же промпт chat.v1.
 */
export const PublicAskSchema = z
  .object({
    text: AskSchema.shape.text,
    history: z
      .array(
        z
          .object({
            role: z.enum(['USER', 'ASSISTANT']),
            text: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .max(6)
      .default([]),
  })
  .strict();
export type PublicAskInput = z.infer<typeof PublicAskSchema>;

export interface PublicChatReply {
  disclaimer: string;
  answer: string;
}

export interface ChatMessageView {
  id: string;
  role: 'USER' | 'ASSISTANT';
  text: string;
  createdAt: string;
}

export interface ChatView {
  disclaimer: string;
  messages: ChatMessageView[];
}

export interface ChatReply {
  disclaimer: string;
  question: ChatMessageView;
  answer: ChatMessageView;
}
