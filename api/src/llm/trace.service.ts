import { Inject, Injectable, Logger } from '@nestjs/common';
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
}

/** Журнал обращений к модели (таблица LlmCall). */
@Injectable()
export class TraceService {
  private readonly logger = new Logger('LlmCall');

  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  /** Ошибка записи журнала не ломает ответ пользователю, только пишется в лог. */
  async record(entry: TraceEntry): Promise<string | null> {
    try {
      const row = await this.db.llmCall.create({
        data: {
          cabinetId: entry.context.cabinetId,
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
        },
      });
      return row.id;
    } catch (e) {
      this.logger.error(
        `Не удалось записать LlmCall: ${e instanceof Error ? e.name : 'ошибка'}`,
      );
      return null;
    }
  }
}
