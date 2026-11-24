import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { lockActiveCabinet } from '../erasure/cabinet-lock.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LlmOperationHandle } from './llm-operation.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Оценка для ответа без данных о токенах: символов на токен (с запасом) и токенов на картинку. */
const CHARS_PER_TOKEN = 3;
const TOKENS_PER_IMAGE = 1500;

export interface UsageSample {
  provider: string;
  /** Обращение не дало ответа (ошибка связи, квота, ключ). */
  failed: boolean;
  tokensIn?: number | null;
  tokensOut?: number | null;
  /** Для оценки, если провайдер не прислал usage. */
  inputChars: number;
  outputChars: number;
  images: number;
}

/** Ожидание до освобождения места, понятным текстом: «через 3 ч 20 мин». */
export function waitText(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m} мин`;
  return m === 0 ? `${h} ч` : `${h} ч ${m} мин`;
}

/*
 * B18: лимиты модели.
 * 1. Операции на кабинет за скользящие 24 часа: резерв строки LlmOperation под блокировкой кабинета
 *    до первого обращения к модели (после проверки файла и кэша). Параллельные запросы ждут блокировку.
 * 2. Мягкий общий порог токенов за 24 часа по LlmUsageHour (без пользовательских данных, не удаляется
 *    с письмом или аккаунтом). Проверяется перед каждым обращением, включая повторы. Это порог,
 *    а не гарантия: расход обращения становится известен только после ответа.
 */
@Injectable()
export class LlmLimitsService {
  /** Часы подменяются в тестах. */
  now: () => Date = () => new Date();

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  /** Резерв операции. Повторный вызов для уже зарезервированной операции ничего не делает. */
  async reserve(op: LlmOperationHandle): Promise<void> {
    if (op.id || !op.cabinetId) return;
    const cabinetId = op.cabinetId;
    // чат считается отдельно: разговор не съедает лимит писем и объяснений
    const chat = op.kind === 'CHAT';
    const limit = chat
      ? this.config.LLM_DAILY_CHAT_PER_CABINET
      : this.config.LLM_DAILY_OPS_PER_CABINET;
    const now = this.now();
    op.id = await this.db.$transaction(async (tx) => {
      if (!(await lockActiveCabinet(tx, cabinetId))) {
        const exists = await tx.cabinet.count({ where: { id: cabinetId } });
        throw new ApiError(exists ? 'ACCOUNT_DELETING' : 'UNAUTHORIZED');
      }
      if (limit > 0) {
        const recent = await tx.llmOperation.findMany({
          where: {
            cabinetId,
            createdAt: { gt: new Date(now.getTime() - DAY_MS) },
            kind: chat ? 'CHAT' : { not: 'CHAT' },
          },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
          take: limit,
        });
        if (recent.length >= limit) {
          // место освободится, когда самой старой операции окна исполнится 24 часа
          const waitMs = recent[0].createdAt.getTime() + DAY_MS - now.getTime();
          const retryAfterSec = Math.max(1, Math.ceil(waitMs / 1000));
          throw new ApiError(
            'RATE_LIMITED',
            { reason: chat ? 'LLM_DAILY_CHAT' : 'LLM_DAILY_OPS', limit, retryAfterSec },
            chat
              ? `Лимит: не больше ${limit} вопросов в чат за 24 часа. Следующий можно задать через ${waitText(waitMs)}`
              : `Лимит: не больше ${limit} писем и объяснений за 24 часа. Следующее будет доступно через ${waitText(waitMs)}`,
          );
        }
      }
      const row = await tx.llmOperation.create({
        data: { cabinetId, kind: op.kind, createdAt: now },
      });
      return row.id;
    });
  }

  /** Перед каждым обращением к модели. Превышен мягкий порог: 503 LLM_QUOTA, модель не вызывается. */
  async checkBudget(provider: string): Promise<void> {
    const budget = this.config.LLM_DAILY_TOKEN_BUDGET;
    if (budget <= 0 || provider === 'demo') return;
    if ((await this.spentLast24h()) >= budget) throw new ApiError('LLM_QUOTA');
  }

  /** Расход за последние 24 часа (почасовые корзины, задевающие окно; demo не считается). */
  async spentLast24h(): Promise<number> {
    const from = hourOf(new Date(this.now().getTime() - DAY_MS));
    const sum = await this.db.llmUsageHour.aggregate({
      where: { hour: { gte: from }, provider: { not: 'demo' } },
      _sum: { tokensIn: true, tokensOut: true, estimatedTokens: true },
    });
    return (
      (sum._sum.tokensIn ?? 0) +
      (sum._sum.tokensOut ?? 0) +
      (sum._sum.estimatedTokens ?? 0)
    );
  }

  /** После каждого обращения. Ответ без usage не считается бесплатным: расход оценивается по длине. */
  async record(sample: UsageSample): Promise<void> {
    const hour = hourOf(this.now());
    const known =
      typeof sample.tokensIn === 'number' || typeof sample.tokensOut === 'number';
    const estimated =
      !sample.failed && !known && sample.provider !== 'demo'
        ? Math.ceil((sample.inputChars + sample.outputChars) / CHARS_PER_TOKEN) +
          sample.images * TOKENS_PER_IMAGE
        : 0;
    const inc = {
      calls: { increment: 1 },
      failedCalls: { increment: sample.failed ? 1 : 0 },
      tokensIn: { increment: sample.tokensIn ?? 0 },
      tokensOut: { increment: sample.tokensOut ?? 0 },
      callsWithoutUsage: { increment: !sample.failed && !known ? 1 : 0 },
      estimatedTokens: { increment: estimated },
    };
    const where = { hour_provider: { hour, provider: sample.provider } };
    try {
      await this.db.llmUsageHour.upsert({
        where,
        update: inc,
        create: {
          hour,
          provider: sample.provider,
          calls: 1,
          failedCalls: inc.failedCalls.increment,
          tokensIn: inc.tokensIn.increment,
          tokensOut: inc.tokensOut.increment,
          callsWithoutUsage: inc.callsWithoutUsage.increment,
          estimatedTokens: estimated,
        },
      });
    } catch (e) {
      // одновременное создание корзины часа: вторая запись становится обновлением
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
        await this.db.llmUsageHour.update({ where, data: inc });
      else throw e;
    }
  }
}

function hourOf(d: Date): Date {
  return new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS);
}
