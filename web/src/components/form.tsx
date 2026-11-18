import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';
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

/** Обычное текстовое поле: имя, фамилия, адрес. */
export function TextField({
  id,
  label,
  registration,
  error,
  hint,
  autoComplete,
}: FieldProps & { autoComplete?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type="text"
        autoComplete={autoComplete}
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
  // Правка 18-11: кнопка «показать пароль». Меняет только type поля, значение не трогает.
  const [shown, setShown] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          {...registration}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'}
          aria-pressed={shown}
          aria-controls={id}
          onClick={() => setShown((v) => !v)}
        >
          <Icon name={shown ? 'eyeOff' : 'eye'} size={20} />
        </button>
      </div>
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
