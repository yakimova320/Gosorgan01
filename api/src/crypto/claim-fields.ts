import type { VaultService } from './vault.service.js';

/**
 * E01 (#163): какие поля факта шифруются. Значение дат (дата письма, срок) остаётся открытым:
 * срок и так открыт в Deadline.date для напоминаний (решение 26.11), дата письма нужна списку дел.
 * Формулировка и цитата шифруются всегда.
 */
export const OPEN_VALUE_KINDS = new Set(['LETTER_DATE', 'DEADLINE']);

export async function sealClaim<T extends { kind: string; value: string; text: string; quote?: string | null }>(
  vault: VaultService,
  cabinetId: string,
  keyId: string | null,
  claim: T,
): Promise<T> {
  if (!keyId) return claim;
  return {
    ...claim,
    value: OPEN_VALUE_KINDS.has(claim.kind) ? claim.value : await vault.seal(cabinetId, keyId, claim.value),
    text: await vault.seal(cabinetId, keyId, claim.text),
    ...(claim.quote !== undefined ? { quote: await vault.sealOrNull(cabinetId, keyId, claim.quote) } : {}),
  };
}
