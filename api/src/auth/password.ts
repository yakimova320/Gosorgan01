import bcrypt from 'bcryptjs';
import { ApiError } from '../common/api-error.js';

/** ТЗ v2 раздел 11: bcryptjs, cost 12. */
export const BCRYPT_COST = 12;
export const PASSWORD_MIN_CHARS = 10;
/** bcrypt учитывает только первые 72 байта: длиннее не обрезаем молча, а отклоняем (ТЗ v4 раздел 9). */
export const PASSWORD_MAX_BYTES = 72;

/** Бросает PASSWORD_TOO_LONG, если пароль длиннее 72 байт в UTF-8. */
export function assertPasswordFits(password: string): void {
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new ApiError('PASSWORD_TOO_LONG');
  }
}

export function hashPassword(password: string): Promise<string> {
  assertPasswordFits(password);
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES)
    return Promise.resolve(false);
  return bcrypt.compare(password, hash);
}

/**
 * Хэш-заглушка: при входе с неизвестным e-mail всё равно считаем bcrypt,
 * чтобы по времени ответа нельзя было узнать, зарегистрирован ли адрес.
 */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= bcrypt.hash('jasno-dummy-password', BCRYPT_COST);
  return dummyHash;
}
