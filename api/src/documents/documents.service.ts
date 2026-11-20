import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { LlmService, type LlmOperationHandle } from '../llm/llm.service.js';
import {
  TranscribePagesSchema,
  TranscribeSchema,
  checkTranscribe,
  checkTranscribePages,
  type UnreadableReason,
} from '../llm/schemas/transcribe.schema.js';
import { MIME, detectKind, imageSize, type FileKind } from './file-checks.js';
import { MAX_LETTER_CHARS, readPdfText, renderPdfPages } from './pdf-text.js';

export interface DocumentText {
  kind: FileKind;
  mime: string;
  sourceType: 'PDF_TEXT' | 'IMAGE' | 'PDF_SCAN';
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
  /** Сколько обращений к модели потрачено (фото, скан), из общего бюджета 3 на загрузку. */
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

export interface LetterFile {
  data: Buffer;
  kind: FileKind;
}

/**
 * Текст письма из файлов (ТЗ v2 раздел 4, B11): PDF через pdf-parse, фото и страницы
 * PDF-скана через transcribe. Все проверки, которые не требуют модели, выполняются до её вызова.
 * Одно фото: transcribe.v1 (проверен на живой модели). Несколько изображений: transcribe.v2,
 * все страницы одним обращением — на загрузку не больше 3 обращений (с извлечением фактов).
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

  /** B11: один PDF или только фото (JPG, PNG). Номер файла в details — с 1, как на экране. */
  precheckAll(files: Buffer[]): LetterFile[] {
    const checked = files.map((data, i) => {
      try {
        return { data, kind: this.precheck(data) };
      } catch (e) {
        if (!(e instanceof ApiError) || files.length === 1) throw e;
        const body = e.getResponse() as { message: string; details?: object };
        throw new ApiError(
          e.code,
          { ...(body.details ?? {}), file: i + 1 },
          `Файл ${i + 1}: ${body.message}`,
        );
      }
    });
    if (checked.length > 1 && checked.some((f) => f.kind === 'pdf'))
      throw new ApiError('MIXED_FILES', { files: checked.length });
    return checked;
  }

  async extractText(
    files: LetterFile[],
    context: { cabinetId: string; letterId: string },
    /** B18: операция загрузки; transcribe и extract делят её предел попыток и резерв лимита. */
    operation?: LlmOperationHandle,
  ): Promise<DocumentText> {
    const [first] = files;
    if (first.kind === 'pdf') return this.pdf(first.data, context, operation);

    const images = files.map((f, i) => ({
      n: i + 1,
      mime: MIME[f.kind],
      data: f.data,
    }));
    const { pageTexts, attempts } = await this.transcribe(
      images,
      context,
      operation,
    );
    return {
      kind: first.kind,
      mime: MIME[first.kind],
      sourceType: 'IMAGE',
      ...joinPages(pageTexts),
      pageTexts,
      llmAttempts: attempts,
    };
  }

  /** PDF: текстовый слой; страницы без текста (скан) — картинкой через transcribe. */
  private async pdf(
    data: Buffer,
    context: { cabinetId: string; letterId: string },
    operation?: LlmOperationHandle,
  ): Promise<DocumentText> {
    const pages = await readPdfText(data);
    const scans = pages.filter((p) => p.scan).map((p) => p.n);
    let attempts = 0;
    const recognized = new Map<number, string>();
    if (scans.length > 0) {
      const rendered = await renderPdfPages(data, scans);
      const result = await this.transcribe(
        rendered.map((r) => ({ n: r.n, mime: MIME.png, data: r.data })),
        context,
        operation,
      );
      attempts = result.attempts;
      for (const p of result.pageTexts) recognized.set(p.n, p.text);
    }
    const pageTexts = pages.map((p) => ({
      n: p.n,
      text: recognized.get(p.n) ?? p.text,
    }));
    const chars = pageTexts.reduce((sum, p) => sum + p.text.length, 0);
    if (chars > MAX_LETTER_CHARS)
      throw new ApiError('LETTER_TOO_LARGE', { chars });
    return {
      kind: 'pdf',
      mime: MIME.pdf,
      sourceType: scans.length > 0 ? 'PDF_SCAN' : 'PDF_TEXT',
      ...joinPages(pageTexts),
      pageTexts,
      llmAttempts: attempts,
    };
  }

  /**
   * Распознавание изображений страниц. Одна нечитаемая страница — письмо целиком не принимается
   * (без частичного сохранения): UNREADABLE с номерами страниц и причиной первой из них.
   */
  private async transcribe(
    images: { n: number; mime: string; data: Buffer }[],
    context: { cabinetId: string; letterId: string },
    operation?: LlmOperationHandle,
  ): Promise<{ pageTexts: { n: number; text: string }[]; attempts: number }> {
    const common = {
      images: images.map(({ mime, data }) => ({ mime, data })),
      maxAttempts: TRANSCRIBE_MAX_ATTEMPTS,
      context,
      operation,
    };
    // Ошибки связи, квоты и неверного ответа модели остаются LLM_FAILED / LLM_QUOTA.
    const { pages, attempts } =
      images.length === 1
        ? await this.llm
            .callWithTrace({
              ...common,
              prompt: 'transcribe',
              version: 1,
              variables: {},
              schema: TranscribeSchema,
              check: checkTranscribe,
            })
            .then((r) => ({ pages: [r.data], attempts: r.attempts }))
        : await this.llm
            .callWithTrace({
              ...common,
              prompt: 'transcribe',
              version: 2,
              variables: { pageCount: String(images.length) },
              schema: TranscribePagesSchema,
              check: checkTranscribePages(images.length),
            })
            .then((r) => ({ pages: r.data.pages, attempts: r.attempts }));

    const unreadable = pages
      .map((p, i) => ({ ...p, n: images[i].n }))
      .filter((p) => !p.readable);
    if (unreadable.length > 0) {
      const reason = unreadable[0].reason ?? 'OTHER';
      const numbers = unreadable.map((p) => p.n);
      // номер страницы нужен, если страниц несколько (фото или многостраничный PDF)
      const prefix =
        images.length > 1 || numbers[0] !== 1
          ? `${numbers.length > 1 ? 'Страницы' : 'Страница'} ${numbers.join(', ')} не читается. `
          : '';
      throw new ApiError(
        'UNREADABLE',
        { pages: numbers, reason },
        prefix + UNREADABLE_TEXT[reason],
      );
    }
    const pageTexts = pages.map((p, i) => ({
      n: images[i].n,
      text: p.text.trim(),
    }));
    const chars = pageTexts.reduce((sum, p) => sum + p.text.length, 0);
    if (chars > MAX_LETTER_CHARS)
      throw new ApiError('LETTER_TOO_LARGE', { chars });
    return { pageTexts, attempts };
  }
}
