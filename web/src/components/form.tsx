import type { ReactNode } from 'react';
import type { FieldError, UseFormRegisterReturn } from 'react-hook-form';

/*
 * Поля форм (TechBriefing v5, раздел 5.3). Значения, ref, onChange и onBlur приходят из react-hook-form (register).
 * Ошибка показывается после первого ухода из поля, дальше при каждом изменении (mode: 'onTouched').
 * label, aria-invalid, aria-describedby у каждого поля. Без автофокуса.
 */

interface FieldProps {
  id: string;
  label: string;
  registration: UseFormRegisterReturn;
  error?: FieldError;
  hint?: ReactNode;
}

function describedBy(
  id: string,
  error?: FieldError,
  hint?: ReactNode,
): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(
    Boolean,
  );
  return ids.length ? ids.join(' ') : undefined;
}

function FieldMessages({
  id,
  error,
  hint,
}: {
  id: string;
  error?: FieldError;
  hint?: ReactNode;
}) {
  return (
    <>
      {error?.message && (
        <span id={`${id}-error`} className="field-error">
          {error.message}
        </span>
      )}
      {hint && !error && (
        <span id={`${id}-hint`} className="muted">
          {hint}
        </span>
      )}
    </>
  );
}

export function EmailField({
  id,
  label,
  registration,
  error,
  hint,
}: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type="email"
        inputMode="email"
        autoComplete="email"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        {...registration}
      />
      <FieldMessages id={id} error={error} hint={hint} />
    </div>
  );
}

/** Пароль: значение не меняется (без trim), вставка и менеджеры паролей разрешены. */
export function PasswordField({
  id,
  label,
  registration,
  error,
  hint,
  autoComplete,
}: FieldProps & { autoComplete: 'current-password' | 'new-password' }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type="password"
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        {...registration}
      />
      <FieldMessages id={id} error={error} hint={hint} />
    </div>
  );
}

export function CheckboxField({
  id,
  registration,
  error,
  children,
}: Omit<FieldProps, 'label' | 'hint'> & { children: ReactNode }) {
  return (
    <div className="field">
      <label className="checkbox" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          {...registration}
        />
        <span>{children}</span>
      </label>
      <FieldMessages id={id} error={error} />
    </div>
  );
}

/** Общая ошибка формы: ошибки без поля и ошибки сервера. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="alert alert--error" role="alert">
      {message}
    </div>
  );
}

/**
 * Кнопка отправки: недоступна только во время запроса.
 * При ошибках в полях нажатие показывает ошибки и ставит фокус на первое поле с ошибкой.
 */
export function SubmitButton({
  submitting,
  children,
  busyText,
  className = 'btn btn--primary',
}: {
  submitting: boolean;
  children: ReactNode;
  busyText?: string;
  className?: string;
}) {
  return (
    <button
      className={className}
      type="submit"
      disabled={submitting}
      aria-busy={submitting || undefined}
    >
      {submitting && busyText ? busyText : children}
    </button>
  );
}
