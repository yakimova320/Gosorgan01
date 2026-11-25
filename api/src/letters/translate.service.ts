import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { assertAiConsent } from '../cabinet/ai-consent.js';
import { ApiError } from '../common/api-error.js';
import { cabinetLanguage, languageVariables, type Language } from '../common/language.js';
import { LlmService } from '../llm/llm.service.js';
import { TranslateSchema } from '../llm/schemas/translate.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { TranslationView } from './letters.dto.js';

/** Версия промпта перевода: входит в ключ кэша. */
export const TRANSLATE_PROMPT_VERSION = 2; // L07: translate.v2 — перевод на язык кабинета

interface CachedTranslation {
  lang: Language;
  promptVersion: number;
  textHash: string;
  text: string;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Поправка 7 (23.11): машинный перевод всего письма на русский. Отдельная операция с моделью
 * (лимит TRANSLATE), кэш в Letter.translation по тексту письма, языку и версии промпта.
 * Перевод не официальный: сайт так и подписывает его. Чужое письмо: 404.
 */
@Injectable()
export class TranslateService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(LlmService) private readonly llm: LlmService,
  ) {}

  async translate(
    cabinetId: string,
    letterId: string,
    requested?: Language,
  ): Promise<TranslationView> {
    const letter = await this.db.letter.findFirst({
      where: { id: letterId, cabinetId },
      select: { id: true, caseId: true, rawText: true, translation: true },
    });
    if (!letter) throw new ApiError('NOT_FOUND');
    // перевод отправляет текст письма модели — нужно действующее согласие (кэш тоже не отдаём)
    await assertAiConsent(this.db, cabinetId);
    const lang = requested ?? (await cabinetLanguage(this.db, cabinetId));

    const textHash = hash(letter.rawText);
    const cached = letter.translation as unknown as CachedTranslation | null;
    if (
      cached?.lang === lang &&
      cached.promptVersion === TRANSLATE_PROMPT_VERSION &&
      cached.textHash === textHash
    )
      return { lang, text: cached.text, machine: true, cached: true };

    const result = await this.llm.call({
      prompt: 'translate',
      version: TRANSLATE_PROMPT_VERSION,
      variables: { letterText: letter.rawText, ...languageVariables(lang) },
      schema: TranslateSchema,
      context: {
        cabinetId,
        letterId,
        ...(letter.caseId ? { caseId: letter.caseId } : {}),
      },
      operation: this.llm.operation(cabinetId, 'TRANSLATE'),
    });
    const entry: CachedTranslation = {
      lang,
      promptVersion: TRANSLATE_PROMPT_VERSION,
      textHash,
      text: result.text,
    };
    // письмо удалили, пока модель отвечала: перевод не сохраняется
    const saved = await this.db.letter.updateMany({
      where: { id: letterId, cabinetId },
      data: { translation: entry as unknown as object },
    });
    if (saved.count !== 1) throw new ApiError('NOT_FOUND');
    return { lang, text: result.text, machine: true, cached: false };
  }
}
