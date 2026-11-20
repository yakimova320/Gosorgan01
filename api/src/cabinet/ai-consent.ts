import { AI_CONSENT_VERSION } from '@jasno/shared';
import { ApiError } from '../common/api-error.js';
import type { PrismaService } from '../prisma/prisma.service.js';

/** K11 (#134): согласие действует, только если дано на текущую версию текста. */
export function hasAiConsent(c: {
  aiConsentAt: Date | null;
  aiConsentVersion: number | null;
}): boolean {
  return c.aiConsentAt !== null && c.aiConsentVersion === AI_CONSENT_VERSION;
}

/**
 * Перед любой отправкой текста письма модели (загрузка, объяснение): без согласия 403
 * AI_CONSENT_REQUIRED. Проверка до сохранения файла и до резерва лимита модели.
 */
export async function assertAiConsent(
  db: Pick<PrismaService, 'cabinet'>,
  cabinetId: string,
): Promise<void> {
  const c = await db.cabinet.findUnique({
    where: { id: cabinetId },
    select: { aiConsentAt: true, aiConsentVersion: true },
  });
  if (!c) throw new ApiError('UNAUTHORIZED');
  if (!hasAiConsent(c)) throw new ApiError('AI_CONSENT_REQUIRED');
}
