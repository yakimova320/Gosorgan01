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
  PDF_UNSUPPORTED_CHARS: 'В тексте есть знаки, которые нельзя напечатать в PDF',
  UNAUTHORIZED: 'Войдите, чтобы продолжить',
  INVALID_CREDENTIALS: 'Неверный e-mail или пароль',
  NOT_FOUND: 'Не найдено',
  EMAIL_TAKEN: 'Этот e-mail уже зарегистрирован',
  NO_CONFIRMED_CLAIMS: 'Сначала подтвердите факты письма',
  FILE_TOO_LARGE: 'Файл слишком большой',
  NO_FILE: 'Выберите файл письма: PDF, JPG или PNG',
  FILE_DAMAGED: 'Файл повреждён или не открывается. Попробуйте другой файл',
  PDF_ENCRYPTED: 'PDF защищён паролем. Сохраните его без пароля или сфотографируйте письмо',
  CLAIM_STATE: 'Этот факт уже изменён. Обновите страницу',
  CASE_CLOSED: 'Дело завершено. Откройте его снова или создайте новое',
  LETTER_IN_CASE: 'Письмо уже в деле. Выберите дело из списка, чтобы перенести его',
  LETTER_TOO_LARGE: 'Файлы письма вместе слишком большие',
  UNSUPPORTED_TYPE: 'Этот формат не подходит. Загрузите PDF, JPG или PNG',
  UNREADABLE: 'Не получилось прочитать письмо. Сделайте новое фото при дневном свете',
  SCAN_PDF_NOT_SUPPORTED: 'В этом PDF нет текста. Сфотографируйте страницы письма',
  DATES_NOT_VERIFIED: 'Не удалось надёжно объяснить сроки. Посмотрите срок в оригинале письма',
  DRAFT_VERIFICATION_FAILED: 'Черновик не прошёл проверку',
  LEGAL_REFERRAL: 'С этим лучше обратиться в консультацию',
  RATE_LIMITED: 'Слишком много попыток. Подождите немного',
  ACCOUNT_DELETING: 'Удаление аккаунта продолжается. Повторять запрос не нужно',
  ERASURE_FAILED: 'Не получилось удалить аккаунт. Попробуйте ещё раз позже',
  INTERNAL_ERROR: 'Что-то пошло не так. Попробуйте ещё раз',
  LLM_FAILED: 'Не получилось разобрать письмо. Попробуйте ещё раз',
  LLM_QUOTA: 'Ja!sno сейчас перегружен. Попробуйте позже',
  // Ошибки, которые возникают в браузере
  NETWORK: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз',
  TIMEOUT: 'Сервер долго не отвечает. Попробуйте ещё раз',
  BAD_RESPONSE: 'Сервер ответил непонятно. Попробуйте ещё раз',
  NOT_CONNECTED: 'Эта функция ещё не подключена к серверу',
};

/**
 * Ошибка API как обычный объект: её можно хранить в Redux (RTK Query кладёт ошибки в store).
 * code: код сервера ({ code, message }) или NETWORK, TIMEOUT, BAD_RESPONSE, NOT_CONNECTED, CANCELLED.
 */
export interface ApiError {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
}

export function apiError(code: string, status?: number, message?: string, details?: unknown): ApiError {
  return { code, message: message || messageFor(code), status, details };
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ApiError).code === 'string' &&
    typeof (value as ApiError).message === 'string'
  );
}

export function messageFor(code: string, fallback?: string): string {
  return MESSAGES[code] ?? fallback ?? MESSAGES.INTERNAL_ERROR;
}

/** Текст любой ошибки для показа человеку. */
export function errorText(error: unknown): string {
  if (isApiError(error)) return error.message || messageFor(error.code);
  return messageFor('INTERNAL_ERROR');
}

/**
 * B18: исчерпан лимит операций с моделью за 24 часа. Повтор сразу бесполезен: в тексте сервера
 * указано, через сколько освободится место.
 */
export function isDailyLimit(error: unknown): boolean {
  if (!isApiError(error) || error.code !== 'RATE_LIMITED') return false;
  const details = (error as { details?: { reason?: unknown } }).details;
  return details?.reason === 'LLM_DAILY_OPS';
}

export function errorCode(error: unknown): string | null {
  return isApiError(error) ? error.code : null;
}
