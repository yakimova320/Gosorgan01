/*
 * Тексты ошибок для человека по коду ошибки API.
 * Сервер тоже присылает message по-русски; этот список нужен для ошибок без ответа сервера
 * (нет сети, тайм-аут) и для одинаковых формулировок на всех экранах.
 */

const MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: 'Проверьте введённые данные',
  CONSENT_REQUIRED: 'Нужно согласие на обработку данных',
  PASSWORD_TOO_LONG: 'Пароль слишком длинный',
  RESET_TOKEN_INVALID: 'Ссылка недействительна или устарела. Запросите новое письмо',
  TOO_MANY_FILES: 'Слишком много файлов для одного письма',
  UNAUTHORIZED: 'Войдите, чтобы продолжить',
  INVALID_CREDENTIALS: 'Неверный e-mail или пароль',
  NOT_FOUND: 'Не найдено',
  EMAIL_TAKEN: 'Этот e-mail уже зарегистрирован',
  NO_CONFIRMED_CLAIMS: 'Сначала подтвердите факты письма',
  FILE_TOO_LARGE: 'Файл слишком большой',
  LETTER_TOO_LARGE: 'Файлы письма вместе слишком большие',
  UNSUPPORTED_TYPE: 'Этот формат не подходит. Загрузите PDF, JPG или PNG',
  UNREADABLE: 'Не получилось прочитать письмо. Сделайте новое фото при дневном свете',
  SCAN_PDF_NOT_SUPPORTED: 'В этом PDF нет текста. Сфотографируйте страницы письма',
  DATES_NOT_VERIFIED: 'Не удалось надёжно объяснить сроки. Посмотрите срок в оригинале письма',
  DRAFT_VERIFICATION_FAILED: 'Черновик не прошёл проверку',
  LEGAL_REFERRAL: 'С этим лучше обратиться в консультацию',
  RATE_LIMITED: 'Слишком много попыток. Подождите немного',
  INTERNAL_ERROR: 'Что-то пошло не так. Попробуйте ещё раз',
  LLM_FAILED: 'Не получилось разобрать письмо. Попробуйте ещё раз',
  LLM_QUOTA: 'Ja!sno сейчас перегружен. Попробуйте позже',
  // Ошибки, которые возникают в браузере
  NETWORK: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз',
  TIMEOUT: 'Сервер долго не отвечает. Попробуйте ещё раз',
  BAD_RESPONSE: 'Сервер ответил непонятно. Попробуйте ещё раз',
  NOT_CONNECTED: 'Эта функция ещё не подключена к серверу',
};

export class ApiClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export function messageFor(code: string, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? MESSAGES.INTERNAL_ERROR;
}

/** Текст любой ошибки для показа человеку. */
export function errorText(error: unknown): string {
  if (error instanceof ApiClientError) return error.message || messageFor(error.code);
  return messageFor('INTERNAL_ERROR');
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiClientError ? error.code : null;
}
