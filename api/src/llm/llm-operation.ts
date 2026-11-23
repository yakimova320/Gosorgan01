/** ТЗ v4 раздел 10: не больше 3 обращений к модели на одну операцию, включая все проверки и повторы. */
export const MAX_ATTEMPTS = 3;

export type LlmOperationKind = 'UPLOAD' | 'EXPLAIN' | 'TRANSLATE' | 'OTHER';

/**
 * B18: одна операция пользователя (загрузка письма, объяснение). Все вызовы модели внутри неё
 * (фото = transcribe + extract, повторы) делят общий предел MAX_ATTEMPTS и один id.
 * Резерв (LlmOperation) делает LlmService перед первым обращением к модели.
 */
export class LlmOperationHandle {
  /** id строки LlmOperation после резерва; null — модель ещё не вызывалась. */
  id: string | null = null;
  /** Обращений к модели уже сделано в этой операции. */
  used = 0;

  constructor(
    readonly cabinetId: string | null,
    readonly kind: LlmOperationKind,
  ) {}

  get remaining(): number {
    return Math.max(0, MAX_ATTEMPTS - this.used);
  }
}
