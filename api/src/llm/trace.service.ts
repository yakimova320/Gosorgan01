import { Inject, Injectable, Logger } from '@nestjs/common';
import { lockActiveCabinet } from '../erasure/cabinet-lock.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface LlmContext {
  /** null: гость (чат-помощник без входа) */
  cabinetId: string | null;
  letterId?: string;
  caseId?: string;
}

export interface TraceEntry {
  context: LlmContext;
  promptName: string;
  promptVersion: number;
  provider: string;
  model: string;
  /** Уже замаскированный вход; фото только описанием «image, N KB». */
  input: string;
  output: string | null;
  ok: boolean;
  error: string | null;
  attempts: number;
  durationMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  /** B18: операция пользователя (LlmOperation), null — без кабинета или резерва. */
  operationId?: string | null;
}

/** Журнал обращений к модели (таблица LlmCall). */
@Injectable()
export class TraceService {
  private readonly logger = new Logger('LlmCall');

  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  /**
   * Ошибка записи журнала не ломает ответ пользователю, только пишется в лог.
   * Запись кабинета идёт под блокировкой его строки: если аккаунт удаляется или уже удалён
   * (запоздалый ответ модели), строка не пишется (A01).
   */
  async record(entry: TraceEntry): Promise<string | null> {
    const cabinetId = entry.context.cabinetId;
    try {
      return await this.db.$transaction(async (tx) => {
        if (cabinetId && !(await lockActiveCabinet(tx, cabinetId))) {
          this.logger.log('LlmCall не записан: аккаунт удаляется или удалён');
          return null;
        }
        const row = await tx.llmCall.create({
          data: {
            cabinetId,
            letterId: entry.context.letterId ?? null,
            caseId: entry.context.caseId ?? null,
            promptName: entry.promptName,
            promptVersion: entry.promptVersion,
            provider: entry.provider,
            model: entry.model,
            input: entry.input,
            output: entry.output,
            ok: entry.ok,
            error: entry.error,
            attempts: entry.attempts,
            durationMs: entry.durationMs,
            tokensIn: entry.tokensIn,
            tokensOut: entry.tokensOut,
            operationId: entry.operationId ?? null,
          },
        });
        return row.id;
      });
    } catch (e) {
      this.logger.error(
        `Не удалось записать LlmCall: ${e instanceof Error ? e.name : 'ошибка'}`,
      );
      return null;
    }
  }
}
