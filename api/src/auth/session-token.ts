import { createHash, randomBytes } from 'node:crypto';

/** Новый токен: 32 случайных байта в base64url (ТЗ v2 раздел 11). Отдаётся только клиенту. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 от токена: только это хранится в базе. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** e-mail для логов: a***@example.org */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
