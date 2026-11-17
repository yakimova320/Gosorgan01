/*
 * Формат ошибок проверки (TechBriefing v5, раздел 5.2):
 * { code, message, details: { fields: { "profile.numbers.0.value": "текст" }, form?: ["текст"] } }
 * fields: ошибки полей по пути через точку; form: ошибки без поля.
 */

export interface ValidationDetails {
  fields: Record<string, string>;
  form?: string[];
}

export interface IssueLike {
  path: readonly PropertyKey[];
  message: string;
}

/** Путь поля через точку: ['profile', 'numbers', 0, 'value'] → 'profile.numbers.0.value'. */
export function fieldPath(path: readonly PropertyKey[]): string {
  return path.map((p) => String(p)).join('.');
}

/** Список ошибок Zod → details. Для каждого поля остаётся первая ошибка. */
export function toValidationDetails(
  issues: readonly IssueLike[],
): ValidationDetails {
  const fields: Record<string, string> = {};
  const form: string[] = [];
  for (const issue of issues) {
    if (issue.path.length === 0) form.push(issue.message);
    else fields[fieldPath(issue.path)] ??= issue.message;
  }
  return form.length ? { fields, form } : { fields };
}

/** Код ошибки из params.code проверки (например PASSWORD_TOO_LONG). */
export function issueCode(issue: unknown): string | undefined {
  const params = (issue as { params?: { code?: unknown } }).params;
  return typeof params?.code === 'string' ? params.code : undefined;
}
