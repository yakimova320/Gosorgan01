/**
 * Все коды ошибок API и их тексты по-русски.
 * Интерфейс показывает человеку текст по полю code (web/src/api/errors.ts).
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: { status: 400, message: 'Проверьте введённые данные' },
  CONSENT_REQUIRED: {
    status: 400,
    message: 'Нужно согласие на обработку данных',
  },
  PASSWORD_TOO_LONG: { status: 400, message: 'Пароль слишком длинный' },
  RESET_TOKEN_INVALID: {
    status: 400,
    message: 'Ссылка недействительна или устарела. Запросите новое письмо',
  },
  TOO_MANY_FILES: {
    status: 400,
    message: 'Слишком много файлов для одного письма',
  },
  UNAUTHORIZED: { status: 401, message: 'Войдите, чтобы продолжить' },
  INVALID_CREDENTIALS: { status: 401, message: 'Неверный e-mail или пароль' },
  NOT_FOUND: { status: 404, message: 'Не найдено' },
  EMAIL_TAKEN: { status: 409, message: 'Этот e-mail уже зарегистрирован' },
  NO_CONFIRMED_CLAIMS: {
    status: 409,
    message: 'Сначала подтвердите факты письма',
  },
  FILE_TOO_LARGE: { status: 413, message: 'Файл слишком большой' },
  NO_FILE: { status: 400, message: 'Выберите файл письма: PDF, JPG или PNG' },
  FILE_DAMAGED: {
    status: 422,
    message: 'Файл повреждён или не открывается. Попробуйте другой файл',
  },
  PDF_ENCRYPTED: {
    status: 422,
    message:
      'PDF защищён паролем. Сохраните его без пароля или сфотографируйте письмо',
  },
  LETTER_TOO_LARGE: {
    status: 413,
    message: 'Файлы письма вместе слишком большие',
  },
  UNSUPPORTED_TYPE: {
    status: 415,
    message: 'Этот формат не подходит. Загрузите PDF, JPG или PNG',
  },
  UNREADABLE: {
    status: 422,
    message:
      'Не получилось прочитать письмо. Сделайте новое фото при дневном свете',
  },
  SCAN_PDF_NOT_SUPPORTED: {
    status: 422,
    message: 'В этом PDF нет текста. Сфотографируйте страницы письма',
  },
  DATES_NOT_VERIFIED: {
    status: 422,
    message:
      'Не удалось надёжно объяснить сроки. Посмотрите срок в оригинале письма',
  },
  DRAFT_VERIFICATION_FAILED: {
    status: 422,
    message: 'Черновик не прошёл проверку',
  },
  LEGAL_REFERRAL: {
    status: 422,
    message: 'С этим лучше обратиться в консультацию',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Слишком много попыток. Подождите немного',
  },
  INTERNAL_ERROR: {
    status: 500,
    message: 'Что-то пошло не так. Попробуйте ещё раз',
  },
  LLM_FAILED: {
    status: 502,
    message: 'Не получилось разобрать письмо. Попробуйте ещё раз',
  },
  LLM_QUOTA: {
    status: 503,
    message: 'Ja!sno сейчас перегружен. Попробуйте позже',
  },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** Код по HTTP-статусу для ошибок, которые бросил сам NestJS (например, неизвестный адрес). */
export function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'VALIDATION_FAILED';
    case 401:
      return 'UNAUTHORIZED';
    case 404:
      return 'NOT_FOUND';
    case 413:
      return 'FILE_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_TYPE';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}
