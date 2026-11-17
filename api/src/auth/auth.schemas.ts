/*
 * Схемы регистрации и входа общие с сайтом: packages/shared (TechBriefing v5, раздел 5.1).
 * Проверка 72 байт даёт код PASSWORD_TOO_LONG, отсутствие согласия: CONSENT_REQUIRED (ApiErrorFilter).
 */
export {
  LoginSchema,
  RegisterSchema,
  type LoginInput,
  type RegisterInput,
} from '@jasno/shared';
