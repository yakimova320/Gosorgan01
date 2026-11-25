import { getLang, t, tMsg } from '../i18n';
/*
 * Тексты ошибок для человека по коду ошибки API.
 * Сервер тоже присылает message по-русски; этот список нужен для ошибок без ответа сервера
 * (нет сети, тайм-аут) и для одинаковых формулировок на всех экранах.
 */

const MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: t('Проверьте введённые данные'),
  CONSENT_REQUIRED: t('Нужно согласие на обработку данных'),
  AI_CONSENT_REQUIRED: t('Чтобы разобрать письмо, нужно согласие на анализ текста ИИ. Дайте его в профиле или перед загрузкой'),
  PASSWORD_TOO_LONG: t('Пароль слишком длинный'),
  RESET_TOKEN_INVALID: t('Ссылка недействительна или устарела. Запросите новое письмо'),
  TOO_MANY_FILES: t('Слишком много файлов для одного письма'),
  MIXED_FILES: t('Загрузите либо один PDF, либо фото страниц одного письма'),
  PDF_UNSUPPORTED_CHARS: t('В тексте есть знаки, которые нельзя напечатать в PDF'),
  UNAUTHORIZED: t('Войдите, чтобы продолжить'),
  INVALID_CREDENTIALS: t('Неверный e-mail или пароль'),
  NOT_FOUND: t('Не найдено'),
  EMAIL_TAKEN: t('Этот e-mail уже зарегистрирован'),
  NO_CONFIRMED_CLAIMS: t('Сначала подтвердите факты письма'),
  FILE_TOO_LARGE: t('Файл слишком большой'),
  NO_FILE: t('Выберите файл письма: PDF, JPG или PNG'),
  FILE_DAMAGED: t('Файл повреждён или не открывается. Попробуйте другой файл'),
  PDF_ENCRYPTED: t('PDF защищён паролем. Сохраните его без пароля или сфотографируйте письмо'),
  CLAIM_STATE: t('Этот факт уже изменён. Обновите страницу'),
  CASE_CLOSED: t('Дело завершено. Откройте его снова или создайте новое'),
  LETTER_IN_CASE: t('Письмо уже в деле. Выберите дело из списка, чтобы перенести его'),
  LETTER_TOO_LARGE: t('Файлы письма вместе слишком большие'),
  UNSUPPORTED_TYPE: t('Этот формат не подходит. Загрузите PDF, JPG или PNG'),
  UNREADABLE: t('Не получилось прочитать письмо. Сделайте новое фото при дневном свете'),
  SCAN_PDF_NOT_SUPPORTED: t('В этом PDF нет текста. Сфотографируйте страницы письма'),
  DATES_NOT_VERIFIED: t('Не удалось надёжно объяснить сроки. Посмотрите срок в оригинале письма'),
  DRAFT_VERIFICATION_FAILED: t('Черновик не прошёл проверку'),
  LEGAL_REFERRAL: t('С этим лучше обратиться в консультацию'),
  RATE_LIMITED: t('Слишком много попыток. Подождите немного'),
  ACCOUNT_DELETING: t('Удаление аккаунта продолжается. Повторять запрос не нужно'),
  ERASURE_FAILED: t('Не получилось удалить аккаунт. Попробуйте ещё раз позже'),
  INTERNAL_ERROR: t('Что-то пошло не так. Попробуйте ещё раз'),
  LLM_FAILED: t('Не получилось разобрать письмо. Попробуйте ещё раз'),
  LLM_QUOTA: t('Ja!sno сейчас перегружен. Попробуйте позже'),
  // Ошибки, которые возникают в браузере
  NETWORK: t('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз'),
  TIMEOUT: t('Сервер долго не отвечает. Попробуйте ещё раз'),
  BAD_RESPONSE: t('Сервер ответил непонятно. Попробуйте ещё раз'),
  NOT_CONNECTED: t('Эта функция ещё не подключена к серверу'),
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
  // L07: сервер присылает текст по-русски; на другом языке — свой текст по коду ошибки
  if (isApiError(error))
    return getLang() !== 'ru' && error.code in MESSAGES
      ? messageFor(error.code)
      : tMsg(error.message || messageFor(error.code));
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
