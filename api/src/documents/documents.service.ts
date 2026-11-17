import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { LlmService } from '../llm/llm.service.js';
import {
  TranscribeSchema,
  checkTranscribe,
  type UnreadableReason,
} from '../llm/schemas/transcribe.schema.js';
import { MIME, detectKind, imageSize, type FileKind } from './file-checks.js';
import { MAX_LETTER_CHARS, readPdfText } from './pdf-text.js';

export interface DocumentText {
  kind: FileKind;
  mime: string;
  sourceType: 'PDF_TEXT' | 'IMAGE';
  text: string;
  /** Метаданные страниц для базы: start и end — границы текста страницы в text. */
  pages: {
    n: number;
    readable: boolean;
    chars: number;
    start: number;
    end: number;
  }[];
  /** Текст каждой страницы отдельно (только в памяти): проверка цитат и номеров страниц. */
  pageTexts: { n: number; text: string }[];
  /** Сколько обращений к модели потрачено (фото), из общего бюджета 3 на загрузку. */
  llmAttempts: number;
}

/** На распознавание фото не больше 2 обращений: хотя бы одно остаётся на извлечение фактов. */
export const TRANSCRIBE_MAX_ATTEMPTS = 2;

/** Склеивает страницы в один текст и запоминает границы каждой страницы (без разбора маркеров). */
export function joinPages(pageTexts: { n: number; text: string }[]): {
  text: string;
  pages: {
    n: number;
    readable: boolean;
    chars: number;
    start: number;
    end: number;
  }[];
} {
  let text = '';
  const pages = pageTexts.map((p, i) => {
    if (pageTexts.length > 1)
      text += `${i ? '\n\n' : ''}--- Seite ${p.n} ---\n`;
    const start = text.length;
    text += p.text;
    return {
      n: p.n,
      readable: true,
      chars: p.text.length,
      start,
      end: text.length,
    };
  });
  return { text, pages };
}

/** Тексты для человека по коду причины. Текст модели о причине не показывается. */
const UNREADABLE_TEXT: Record<UnreadableReason, string> = {
  BLURRY:
    'Фото размыто. Сделайте новое фото: телефон неподвижно, письмо целиком в кадре',
  DARK: 'Фото тёмное или с бликами. Сделайте новое фото при дневном свете',
  CUT_OFF: 'Письмо обрезано. Сфотографируйте страницу целиком',
  NOT_A_LETTER: 'На фото не видно письма. Сфотографируйте страницу письма',
  OTHER:
    'Не получилось прочитать письмо. Сделайте новое фото при дневном свете',
  DEMO_UNKNOWN:
    'В демо-режиме Ja!sno распознаёт только примеры писем из набора fixtures',
};

/**
 * Текст письма из файла (ТЗ v2 раздел 4): PDF через pdf-parse, фото через transcribe.v1.
 * Все проверки, которые не требуют модели, выполняются до её вызова.
 */
@Injectable()
export class DocumentsService {
  constructor(@Inject(LlmService) private readonly llm: LlmService) {}

  /** Тип по содержимому и проверки без модели. Ошибки: UNSUPPORTED_TYPE, FILE_DAMAGED, FILE_TOO_LARGE. */
  precheck(data: Buffer): FileKind {
    const kind = detectKind(data);
    if (!kind) throw new ApiError('UNSUPPORTED_TYPE');
    if (kind !== 'pdf') imageSize(data, kind);
    return kind;
  }

  async extractText(
    data: Buffer,
    kind: FileKind,
    context: { cabinetId: string; letterId: string },
  ): Promise<DocumentText> {
    if (kind === 'pdf') {
      const pageTexts = await readPdfText(data);
      return {
        kind,
        mime: MIME.pdf,
        sourceType: 'PDF_TEXT',
        ...joinPages(pageTexts),
        pageTexts,
        llmAttempts: 0,
      };
    }

    // Ошибки связи, квоты и неверного ответа модели остаются LLM_FAILED / LLM_QUOTA.
    const { data: result, attempts } = await this.llm.callWithTrace({
      prompt: 'transcribe',
      variables: {},
      images: [{ mime: MIME[kind], data }],
      schema: TranscribeSchema,
      check: checkTranscribe,
      maxAttempts: TRANSCRIBE_MAX_ATTEMPTS,
      context,
    });
    if (!result.readable) {
      const reason = result.reason ?? 'OTHER';
      throw new ApiError(
        'UNREADABLE',
        { pages: [1], reason },
        UNREADABLE_TEXT[reason],
      );
    }
    const text = result.text.trim();
    if (text.length > MAX_LETTER_CHARS)
      throw new ApiError('LETTER_TOO_LARGE', { chars: text.length });
    return {
      kind,
      mime: MIME[kind],
      sourceType: 'IMAGE',
      ...joinPages([{ n: 1, text }]),
      pageTexts: [{ n: 1, text }],
      llmAttempts: attempts,
    };
  }
}
