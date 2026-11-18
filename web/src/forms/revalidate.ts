import type { FieldPath, FieldValues, UseFormReturn } from 'react-hook-form';

/*
 * Поле «повторите пароль» зависит от пароля. Опция deps у register проверяет его сразу,
 * даже если пользователь до него ещё не дошёл: ошибка появлялась раньше времени, а при уходе
 * из поля пропадала и сдвигала кнопку под пальцем. Правило (TechBriefing v5, 5.3): ошибка поля
 * только после первого ухода из него, поэтому перепроверяем повтор, только если он уже тронут.
 */
export function revalidateIfTouched<T extends FieldValues>(
  form: Pick<UseFormReturn<T>, 'getFieldState' | 'trigger'>,
  field: FieldPath<T>,
) {
  return () => {
    if (form.getFieldState(field).isTouched) void form.trigger(field);
  };
}
