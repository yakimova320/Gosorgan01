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

/*
 * Поправка 6 (23.11, вечер): адрес в профиле по частям — улица с домом, индекс, город.
 * Черновики и письма по-прежнему берут одну строку address: сервер собирает её из частей
 * (composeAddress). Старые профили без частей сайт разбирает по шаблону «Улица 1, 12345 Город».
 */
export const StreetSchema = z
  .string()
  .trim()
  .min(3, { message: 'Введите улицу и номер дома' })
  .max(150, { message: 'Не больше 150 знаков' });
export const PostalCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{5}$/, { message: 'Индекс: 5 цифр' });
export const CitySchema = z
  .string()
  .trim()
  .min(2, { message: 'Введите город' })
  .max(100, { message: 'Не больше 100 знаков' });

export interface AddressParts {
  street: string;
  postalCode: string;
  city: string;
}

export const AddressPartsSchema = z.object({
  street: StreetSchema,
  postalCode: PostalCodeSchema,
  city: CitySchema,
});

/** «Musterstr. 1, 10115 Berlin» — так адрес стоит в блоке отправителя черновика. */
export function composeAddress(p: AddressParts): string {
  return `${p.street.trim()}, ${p.postalCode.trim()} ${p.city.trim()}`;
}

/** Обратный разбор одной строки; не по шаблону — null (человек заполнит части сам). */
export function splitAddress(address: string): AddressParts | null {
  const m = /^(.+?),\s*(\d{5})\s+(.+)$/.exec(address.trim());
  return m ? { street: m[1].trim(), postalCode: m[2], city: m[3].trim() } : null;
}

export const RegisterSchema = z.object({
  email: EmailSchema,
  password: NewPasswordSchema,
  firstName: FirstNameSchema,
  lastName: LastNameSchema,
  address: AddressSchema,
  consent: z.literal(true, {
    error: 'Нужно согласие на обработку данных',
  }),
  /**
   * K11 (#134): отдельное согласие на анализ письма ИИ. Не обязательно для регистрации:
   * без него нельзя загрузить письмо, спросим перед первой загрузкой.
   */
  aiConsent: z.boolean().optional(),
});
// Код CONSENT_REQUIRED для поля consent: см. SPECIAL_CODES.
export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * K11 (#134): версия текста согласия на анализ ИИ. Меняется при изменении текста:
 * согласие на старую версию считается недействительным.
 */
export const AI_CONSENT_VERSION = 1;

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
    street: StreetSchema.optional(),
    postalCode: PostalCodeSchema.optional(),
    city: CitySchema.optional(),
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
