import { z } from 'zod';
import { CurrentPasswordSchema, NewPasswordSchema } from './password.js';

/*
 * Контракты запросов для api и web (TechBriefing v5, раздел 5.1).
 * Сервер проверяет вход сам по этим же схемам; владелец объекта, текущий пароль
 * и состояние данных проверяются только на сервере.
 * params.code у проверки: сервер отвечает этим кодом ошибки вместо VALIDATION_FAILED.
 */

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, { message: 'Введите e-mail' })
  .pipe(
    z
      .email({ message: 'Неверный e-mail' })
      .max(254, { message: 'Слишком длинный e-mail' }),
  );

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: NewPasswordSchema,
  consent: z.literal(true, {
    error: 'Нужно согласие на обработку данных',
  }),
});
// Код CONSENT_REQUIRED для поля consent: см. SPECIAL_CODES.
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: CurrentPasswordSchema,
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const ForgotPasswordSchema = z.object({ email: EmailSchema });
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(1, { message: 'Ссылка неполная' }),
  newPassword: NewPasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const ChangePasswordSchema = z.object({
  oldPassword: CurrentPasswordSchema,
  newPassword: NewPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const DeleteAccountSchema = z.object({
  password: CurrentPasswordSchema,
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Не больше ${max} знаков` });

export const ProfileSchema = z
  .object({
    firstName: text(100).optional(),
    lastName: text(100).optional(),
    address: text(300).optional(),
    numbers: z
      .array(
        z.object({ label: text(80).min(1), value: text(80).min(1) }).strict(),
      )
      .max(10)
      .optional(),
  })
  .strict();
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * Поля, ошибка в которых даёт свой код API вместо VALIDATION_FAILED.
 * Ключ: путь поля в запросе. Используется сервером (ApiErrorFilter).
 */
export const SPECIAL_CODES: Record<string, string> = {
  consent: 'CONSENT_REQUIRED',
};
