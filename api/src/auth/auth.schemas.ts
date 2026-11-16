import { z } from 'zod';
import { PASSWORD_MIN_CHARS } from './password.js';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'Неверный e-mail' }).max(254));

/** Длина в байтах (72) проверяется отдельно и даёт свой код PASSWORD_TOO_LONG. */
const password = z
  .string()
  .min(PASSWORD_MIN_CHARS, {
    message: `Пароль от ${PASSWORD_MIN_CHARS} знаков`,
  });

export const RegisterSchema = z.object({
  email,
  password,
  /** true обязательно; иначе CONSENT_REQUIRED */
  consent: z.boolean().optional(),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email,
  password: z.string().min(1).max(1000),
});
export type LoginInput = z.infer<typeof LoginSchema>;
