import { z } from 'zod';

/** Правила пароля (ТЗ v4 раздел 9). bcrypt учитывает только первые 72 байта. */
export const PASSWORD_MIN_CHARS = 10;
export const PASSWORD_MAX_BYTES = 72;

/** Длина строки в байтах UTF-8. TextEncoder есть и в браузере, и в Node. */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Новый пароль: регистрация, восстановление, смена. Значение не меняется (без trim).
 * Превышение 72 байт отмечено кодом PASSWORD_TOO_LONG: сервер отвечает именно им.
 */
export const NewPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_CHARS, {
    message: `Пароль: не меньше ${PASSWORD_MIN_CHARS} знаков`,
  })
  .refine((v) => utf8Bytes(v) <= PASSWORD_MAX_BYTES, {
    message:
      'Пароль слишком длинный: русские буквы считаются за два знака, максимум около 36 букв',
    params: { code: 'PASSWORD_TOO_LONG' },
  });

/** Существующий пароль: вход, текущий пароль, удаление аккаунта. Требования к новому паролю не применяются. */
export const CurrentPasswordSchema = z
  .string()
  .min(1, { message: 'Введите пароль' })
  .max(1000, { message: 'Пароль слишком длинный' });
