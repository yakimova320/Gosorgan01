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

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { message: `Не больше ${max} знаков` });

/**
 * Имя и фамилия: латиница, в том числе умлауты и буквы с диакритикой (ä, ß, é, ł).
 * Между частями: пробел, дефис, апостроф ' или ’. Кириллица и цифры не допускаются.
 * Пробелы по краям убираются, буквы приводятся к форме NFC (é одним знаком).
 */
export const LATIN_NAME = /^\p{Script=Latin}+(?:[ \-'’]\p{Script=Latin}+)*$/u;

const latinName = (message: string) =>
  z
    .string()
    .transform((v) => v.normalize('NFC').trim())
    .pipe(
      z
        .string()
        .min(1, { message })
        .max(100, { message: 'Не больше 100 знаков' })
        .regex(LATIN_NAME, { message }),
    );

export const FirstNameSchema = latinName('Введите имя латинскими буквами');
export const LastNameSchema = latinName('Введите фамилию латинскими буквами');
/** Адрес проживания: без ограничения алфавита. */
export const AddressSchema = z
  .string()
  .trim()
  .min(5, { message: 'Введите адрес проживания' })
  .max(300, { message: 'Не больше 300 знаков' });

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: NewPasswordSchema,
  firstName: FirstNameSchema,
  lastName: LastNameSchema,
  address: AddressSchema,
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
  token: z
    .string()
    .min(1, { message: 'Ссылка неполная' })
    .max(200, { message: 'Ссылка неполная' }),
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

export const PROFILE_NUMBERS_MAX = 10;
const NO_CYRILLIC = /^[^\p{Script=Cyrillic}]*$/u;
/** Строки шаблона черновика: номер профиля с таким названием спутал бы проверку. */
const RESERVED_NUMBER_LABEL = /^(ihr zeichen|datum|betreff)$/i;

/**
 * Номер из профиля для черновика (F05): название по-немецки, как в письмах ведомства
 * («Kundennummer», «BG-Nummer»), и сам номер. Попадает в блок отправителя черновика,
 * поэтому кириллица не допускается.
 */
export const ProfileNumberSchema = z
  .object({
    label: text(80)
      .min(1, { message: 'Введите название номера' })
      .regex(NO_CYRILLIC, {
        message: 'Название по-немецки, как в письме ведомства',
      })
      .refine((v) => !RESERVED_NUMBER_LABEL.test(v), {
        message: 'Эта строка уже есть в шаблоне письма, назовите номер иначе',
      }),
    value: text(80)
      .min(1, { message: 'Введите номер' })
      .regex(NO_CYRILLIC, { message: 'Номер латинскими буквами и цифрами' }),
  })
  .strict();
export type ProfileNumber = z.infer<typeof ProfileNumberSchema>;

/** Профиль целиком: имя, фамилия и адрес обязательны всегда. */
export const ProfileSchema = z
  .object({
    firstName: FirstNameSchema,
    lastName: LastNameSchema,
    address: AddressSchema,
    numbers: z
      .array(ProfileNumberSchema)
      .max(PROFILE_NUMBERS_MAX, {
        message: `Не больше ${PROFILE_NUMBERS_MAX} номеров`,
      })
      .optional(),
  })
  .strict();
export type Profile = z.infer<typeof ProfileSchema>;

/**
 * Изменение профиля: можно прислать одно поле. Сервер объединяет его с сохранённым
 * профилем и проверяет итог по ProfileSchema: обязательное поле очистить нельзя.
 */
export const ProfilePatchSchema = ProfileSchema.partial().strict();
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

/**
 * Поля, ошибка в которых даёт свой код API вместо VALIDATION_FAILED.
 * Ключ: путь поля в запросе. Используется сервером (ApiErrorFilter).
 */
export const SPECIAL_CODES: Record<string, string> = {
  consent: 'CONSENT_REQUIRED',
};
