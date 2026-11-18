import type { Prisma } from '../generated/prisma/client.js';

/**
 * Блокировка строки кабинета внутри транзакции для записи данных пользователя (A01).
 * UPDATE без изменения значения берёт блокировку строки до конца транзакции.
 * false: кабинета нет или он удаляется (deletingAt) — писать нельзя.
 * Удаление аккаунта ставит deletingAt тем же способом и ждёт, пока такие транзакции закончатся,
 * поэтому после постановки отметки новых строк и файлов у кабинета не появляется.
 */
export async function lockActiveCabinet(
  tx: Prisma.TransactionClient,
  cabinetId: string,
): Promise<boolean> {
  const { count } = await tx.cabinet.updateMany({
    where: { id: cabinetId, deletingAt: null },
    data: { deletingAt: null },
  });
  return count === 1;
}
