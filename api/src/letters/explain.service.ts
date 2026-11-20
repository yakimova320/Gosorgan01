import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { LlmService } from '../llm/llm.service.js';
import { ExplainV2Schema } from '../llm/schemas/explain.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertAiConsent } from '../cabinet/ai-consent.js';
import {
  checkExplanation,
  factsForPrompt,
  factsVersion,
  finalizeExplanation,
  type ExplainFact,
  type ExplanationView,
} from './explain.logic.js';

/** Версия промпта объяснения: входит в ключ кэша. */
export const EXPLAIN_PROMPT_VERSION = 2;

interface CachedExplanation {
  lang: 'ru';
  promptVersion: number;
  factsVersion: string;
  explanation: ExplanationView;
}

export type ExplainResponse = ExplanationView & { cached: boolean };

/**
 * Объяснение письма (B08). Кэш в Letter.explanation привязан к версии фактов, языку и версии промпта.
 * Факты изменились, пока модель отвечала: 409 CLAIMS_CHANGED, результат не показывается и не кэшируется.
 * Даты или числа не прошли проверку за 3 попытки: 422 DATES_NOT_VERIFIED.
 */
@Injectable()
export class ExplainService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(LlmService) private readonly llm: LlmService,
  ) {}

  async explain(
    cabinetId: string,
    letterId: string,
    lang: 'ru',
  ): Promise<ExplainResponse> {
    const letter = await this.db.letter.findFirst({
      where: { id: letterId, cabinetId },
      select: { id: true, caseId: true, rawText: true, explanation: true },
    });
    if (!letter) throw new ApiError('NOT_FOUND');
    // K11: объяснение отправляет текст письма модели — нужно действующее согласие (кэш тоже не отдаём)
    await assertAiConsent(this.db, cabinetId);

    const facts = await this.facts(letterId);
    if (facts.length === 0) throw new ApiError('NO_CLAIMS');
    const version = factsVersion(facts);

    const cached = letter.explanation as unknown as CachedExplanation | null;
    if (
      cached?.lang === lang &&
      cached.promptVersion === EXPLAIN_PROMPT_VERSION &&
      cached.factsVersion === version
    )
      return { ...cached.explanation, cached: true };

    let checkFailures = 0;
    let result;
    try {
      result = await this.llm.call({
        prompt: 'explain',
        version: EXPLAIN_PROMPT_VERSION,
        variables: { facts: factsForPrompt(facts), letterText: letter.rawText },
        schema: ExplainV2Schema,
        check: (r) => {
          const problem = checkExplanation(r, facts);
          if (problem) checkFailures++;
          return problem;
        },
        context: {
          cabinetId,
          letterId,
          ...(letter.caseId ? { caseId: letter.caseId } : {}),
        },
        // B18: объяснение из кэша (выше) лимит не тратит; резерв — перед обращением к модели
        operation: this.llm.operation(cabinetId, 'EXPLAIN'),
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'LLM_FAILED' && checkFailures > 0)
        throw new ApiError('DATES_NOT_VERIFIED');
      throw e;
    }
    const explanation = finalizeExplanation(result, facts);

    await this.db.$transaction(async (tx) => {
      const now = await this.facts(letterId, tx);
      if (factsVersion(now) !== version) throw new ApiError('CLAIMS_CHANGED');
      const entry: CachedExplanation = {
        lang,
        promptVersion: EXPLAIN_PROMPT_VERSION,
        factsVersion: version,
        explanation,
      };
      await tx.letter.update({
        where: { id: letterId },
        data: { explanation: entry as unknown as object },
      });
    });
    return { ...explanation, cached: false };
  }

  /** Действующие факты письма: без отклонённых и заменённых. */
  private async facts(
    letterId: string,
    db: Pick<PrismaService, 'claim'> = this.db,
  ): Promise<ExplainFact[]> {
    const rows = await db.claim.findMany({
      where: { letterId, status: { in: ['UNCONFIRMED', 'CONFIRMED'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { deadline: { select: { kind: true } } },
    });
    return rows.map((c) => ({
      id: c.id,
      kind: c.kind,
      value: c.value,
      quote: c.quote,
      status: c.status as ExplainFact['status'],
      ...(c.deadline ? { deadlineKind: c.deadline.kind } : {}),
    }));
  }
}
