import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_CHARS } from '@jasno/shared';
import { useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { CheckboxField, EmailField, FormError, PasswordField, SubmitButton } from '../../components/form';
import { ForgotFormSchema, LoginFormSchema, RegisterFormSchema, ResetFormSchema } from '../../forms/schemas';
import { applyServerError } from '../../forms/serverErrors';
import { useAppDispatch, useSession } from '../../store';
import { useForgotPasswordMutation, useLoginMutation, useRegisterMutation, useResetPasswordMutation } from '../../store/api';
import { signedIn } from '../../store/session';

/*
 * Формы входа и пароля: react-hook-form + схемы из packages/shared (TechBriefing v5, раздел 5).
 * mode 'onTouched': ошибка после первого ухода из поля, дальше при каждом изменении.
 */

const PASSWORD_HINT = `Не меньше ${PASSWORD_MIN_CHARS} знаков`;

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card stack" style={{ maxWidth: 440, width: '100%', margin: '12px auto 0', padding: 22 }}>
      <h1 style={{ fontSize: 26 }}>{title}</h1>
      {children}
    </div>
  );
}

export function LoginPage() {
  const { expired } = useSession();
  const dispatch = useAppDispatch();
  const [login] = useLoginMutation();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof LoginFormSchema>, unknown, z.output<typeof LoginFormSchema>>({
    resolver: zodResolver(LoginFormSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const { sessionToken } = await login(values).unwrap();
      dispatch(signedIn(sessionToken));
      navigate('/app', { replace: true });
    } catch (err) {
      setFormError(applyServerError(err, form.setError, ['email', 'password']));
    }
  });

  return (
    <AuthCard title="Вход">
      {expired && (
        <p className="small text-2" role="status">
          Сессия истекла. Войдите снова.
        </p>
      )}
      <form className="stack" onSubmit={submit} noValidate>
        <EmailField id="email" label="E-mail" registration={form.register('email')} error={errors.email} />
        <PasswordField id="password" label="Пароль" autoComplete="current-password" registration={form.register('password')} error={errors.password} />
        <FormError message={formError} />
        <SubmitButton submitting={isSubmitting} busyText="Входим…">
          Войти
        </SubmitButton>
      </form>
      <Link to="/forgot" className="link">
        Забыли пароль?
      </Link>
      <span className="small text-2">
        Нет аккаунта?{' '}
        <Link to="/register" className="link">
          Зарегистрироваться
        </Link>
      </span>
    </AuthCard>
  );
}

export function RegisterPage() {
  const dispatch = useAppDispatch();
  const [register] = useRegisterMutation();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof RegisterFormSchema>, unknown, z.output<typeof RegisterFormSchema>>({
    resolver: zodResolver(RegisterFormSchema),
    mode: 'onTouched',
    defaultValues: { email: '', password: '', passwordRepeat: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ email, password, consent }) => {
    setFormError(null);
    try {
      const { sessionToken } = await register({ email, password, consent }).unwrap();
      dispatch(signedIn(sessionToken));
      navigate('/app', { replace: true });
    } catch (err) {
      setFormError(applyServerError(err, form.setError, ['email', 'password', 'consent']));
    }
  });

  return (
    <AuthCard title="Регистрация">
      <p className="small text-2">Нужны только e-mail и пароль. Имя, адрес и номера документов Ja!sno не спрашивает.</p>
      <form className="stack" onSubmit={submit} noValidate>
        <EmailField id="r-email" label="E-mail" registration={form.register('email')} error={errors.email} />
        <PasswordField
          id="r-password"
          label="Пароль"
          autoComplete="new-password"
          registration={form.register('password', { deps: ['passwordRepeat'] })}
          error={errors.password}
          hint={PASSWORD_HINT}
        />
        <PasswordField
          id="r-password2"
          label="Повторите пароль"
          autoComplete="new-password"
          registration={form.register('passwordRepeat')}
          error={errors.passwordRepeat}
        />
        <CheckboxField id="r-consent" registration={form.register('consent')} error={errors.consent}>
          Я согласен(на) с обработкой моих данных по правилам Datenschutz. В тестовой версии загружайте только примеры писем.
        </CheckboxField>
        <FormError message={formError} />
        <SubmitButton submitting={isSubmitting} busyText="Создаём кабинет…">
          Зарегистрироваться
        </SubmitButton>
      </form>
      <span className="small text-2">
        Уже есть аккаунт?{' '}
        <Link to="/login" className="link">
          Войти
        </Link>
      </span>
    </AuthCard>
  );
}

export function ForgotPage() {
  const [forgotPassword] = useForgotPasswordMutation();
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof ForgotFormSchema>, unknown, z.output<typeof ForgotFormSchema>>({
    resolver: zodResolver(ForgotFormSchema),
    mode: 'onTouched',
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await forgotPassword(email).unwrap();
      setSent(true);
    } catch (err) {
      setFormError(applyServerError(err, form.setError, ['email']));
    }
  });

  return (
    <AuthCard title="Забыли пароль?">
      {sent ? (
        <div className="alert alert--info" role="status">
          Если такой адрес есть, мы отправили письмо со ссылкой. Ссылка работает один раз и около часа.
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <p className="small text-2">Введите e-mail, с которым вы регистрировались. Придёт письмо со ссылкой для нового пароля.</p>
          <EmailField id="f-email" label="E-mail" registration={form.register('email')} error={errors.email} />
          <FormError message={formError} />
          <SubmitButton submitting={isSubmitting}>Отправить ссылку</SubmitButton>
        </form>
      )}
      <Link to="/login" className="link">
        Назад ко входу
      </Link>
    </AuthCard>
  );
}

export function ResetPage() {
  const [resetPassword] = useResetPasswordMutation();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const token = search.get('token') ?? '';
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof ResetFormSchema>, unknown, z.output<typeof ResetFormSchema>>({
    resolver: zodResolver(ResetFormSchema),
    mode: 'onTouched',
    defaultValues: { newPassword: '', newPasswordRepeat: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ newPassword }) => {
    setFormError(null);
    try {
      await resetPassword({ token, newPassword }).unwrap();
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setFormError(applyServerError(err, form.setError, ['newPassword']));
    }
  });

  if (!token) {
    return (
      <AuthCard title="Новый пароль">
        <div className="alert alert--error">Ссылка неполная. Откройте ссылку из письма ещё раз или запросите новое письмо.</div>
        <Link to="/forgot" className="link">
          Запросить новое письмо
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Новый пароль">
      <form className="stack" onSubmit={submit} noValidate>
        <PasswordField
          id="n-pw"
          label="Новый пароль"
          autoComplete="new-password"
          registration={form.register('newPassword', { deps: ['newPasswordRepeat'] })}
          error={errors.newPassword}
          hint={PASSWORD_HINT}
        />
        <PasswordField
          id="n-pw2"
          label="Повторите пароль"
          autoComplete="new-password"
          registration={form.register('newPasswordRepeat')}
          error={errors.newPasswordRepeat}
        />
        <FormError message={formError} />
        <SubmitButton submitting={isSubmitting}>Сохранить пароль</SubmitButton>
      </form>
      <Link to="/forgot" className="link">
        Запросить новое письмо
      </Link>
    </AuthCard>
  );
}
