import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { errorCode, errorText, isApiError } from '../api/errors';

/*
 * Ошибка сервера → ошибки полей формы (TechBriefing v5, раздел 5.2).
 * details.fields: у известных полей; неизвестные поля и ошибки без поля: общая ошибка формы.
 * Коды, которые относятся к одному полю без details (EMAIL_TAKEN): отдельная таблица CODE_FIELD.
 */

const CODE_FIELD: Record<string, string> = {
  EMAIL_TAKEN: 'email',
};

/** Возвращает текст общей ошибки формы или null, если все ошибки показаны у полей. */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
  /** Префикс пути на сервере: 'profile.' → поле формы firstName */
  prefix = '',
): string | null {
  if (!isApiError(error)) return errorText(error);
  const known = new Set(knownFields);
  let shownAtField = false;
  const formMessages: string[] = [];

  const byCode = CODE_FIELD[errorCode(error) ?? ''];
  if (byCode && known.has(byCode)) {
    setError(
      byCode as Path<T>,
      { type: 'server', message: error.message },
      { shouldFocus: true },
    );
    shownAtField = true;
  }

  const details = error.details as
    { fields?: Record<string, string>; form?: string[] } | undefined;
  for (const [path, message] of Object.entries(details?.fields ?? {})) {
    const field =
      prefix && path.startsWith(prefix) ? path.slice(prefix.length) : path;
    if (known.has(field)) {
      setError(
        field as Path<T>,
        { type: 'server', message },
        { shouldFocus: !shownAtField },
      );
      shownAtField = true;
    } else formMessages.push(message);
  }
  formMessages.push(...(details?.form ?? []));

  if (formMessages.length) return [error.message, ...formMessages].join('. ');
  return shownAtField ? null : errorText(error);
}
