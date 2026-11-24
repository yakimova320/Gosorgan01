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
