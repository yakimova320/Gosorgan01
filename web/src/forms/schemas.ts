import {
  CitySchema,
  PostalCodeSchema,
  StreetSchema,
  ChangePasswordSchema,
  FirstNameSchema,
  LastNameSchema,
  DeleteAccountSchema,
  PROFILE_NUMBERS_MAX,
  ProfileNumberSchema,
  ForgotPasswordSchema,
  LoginSchema,
  NewPasswordSchema,
  RegisterSchema,
} from '@jasno/shared';
import { z } from 'zod';

/*
 * Схемы форм сайта. Основа: общие схемы запросов из packages/shared.
 * Повтор пароля: только поле формы, на сервер не отправляется. Несовпадение показывается у поля повтора.
 */

const repeat = z.string().min(1, { message: 'Повторите пароль' });
const sameAs = (a: string, b: string) => (v: Record<string, unknown>) =>
  v[a] === v[b];
/**
 * Проверка совпадения. when: выполняется, даже если в других полях есть ошибки
 * (иначе Zod пропускает проверку объекта и несовпадение не видно).
 */
const mismatch = (a: string, b: string) => ({
  message: 'Пароли не совпадают',
  path: [b],
  when: (payload: { value: unknown }) => {
    const v = payload.value as Record<string, unknown> | undefined;
    return (
      typeof v?.[a] === 'string' && typeof v?.[b] === 'string' && v[b] !== ''
    );
  },
});

export const LoginFormSchema = LoginSchema;

export const RegisterFormSchema = RegisterSchema.extend({
  passwordRepeat: repeat,
}).refine(
  sameAs('password', 'passwordRepeat'),
  mismatch('password', 'passwordRepeat'),
);

export const ForgotFormSchema = ForgotPasswordSchema;

export const ResetFormSchema = z
  .object({ newPassword: NewPasswordSchema, newPasswordRepeat: repeat })
  .refine(
    sameAs('newPassword', 'newPasswordRepeat'),
    mismatch('newPassword', 'newPasswordRepeat'),
  );

export const ChangePasswordFormSchema = ChangePasswordSchema.extend({
  newPasswordRepeat: repeat,
}).refine(
  sameAs('newPassword', 'newPasswordRepeat'),
  mismatch('newPassword', 'newPasswordRepeat'),
);

export const DeleteAccountFormSchema = DeleteAccountSchema;

/**
 * Профиль на сайте: имя, фамилия, адрес и номера для черновика (F05).
 * На сервер уходят только изменённые поля; список номеров — целиком.
 */
export const ProfileFormSchema = z.object({
  firstName: FirstNameSchema,
  lastName: LastNameSchema,
  // поправка 6: адрес по частям, строку для писем собирает сервер
  street: StreetSchema,
  postalCode: PostalCodeSchema,
  city: CitySchema,
  numbers: z.array(ProfileNumberSchema).max(PROFILE_NUMBERS_MAX),
});
