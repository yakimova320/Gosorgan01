import { z } from 'zod';
import { AskSchema } from '../chat/chat.dto.js';

/** L05: вопрос к архиву писем — те же правила, что у вопроса в чат (1–1000 знаков). */
export const ArchiveAskSchema = AskSchema;
export type ArchiveAskInput = z.infer<typeof ArchiveAskSchema>;

export interface ArchiveSource {
  letterId: string;
  /** Название письма (поправка 8); null — нет */
  letterTitle: string | null;
  /** Когда письмо загружено, ISO 8601 */
  letterCreatedAt: string;
  caseId: string | null;
  caseTitle: string | null;
  /** Точная цитата из текста письма (проверена кодом) */
  quote: string;
}

export interface ArchiveTerm {
  term: string;
  text: string;
}

export interface ArchiveReply {
  disclaimer: string;
  answer: string;
  sources: ArchiveSource[];
  /** Проверенные термины справочника, которые есть в вопросе или в найденных кусках */
  terms: ArchiveTerm[];
  /** Сколько писем ещё не готово к поиску (их векторы считаются при следующих вопросах) */
  pendingLetters: number;
}
