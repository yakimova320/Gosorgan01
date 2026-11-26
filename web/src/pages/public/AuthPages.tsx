import { zodResolver } from '@hookform/resolvers/zod';
import { AI_CONSENT_LABEL } from '../../lib/consent';
import { PASSWORD_MIN_CHARS } from '@jasno/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { CheckboxField, EmailField, FormError, PasswordField, SubmitButton, TextField } from '../../components/form';
import { ForgotFormSchema, LoginFormSchema, RegisterFormSchema, ResetFormSchema } from '../../forms/schemas';
import { errorCode } from '../../api/errors';
import { applyServerError } from '../../forms/serverErrors';
import { revalidateIfTouched } from '../../forms/revalidate';
import { useAppDispatch, useSession } from '../../store';
import { useForgotPasswordMutation, useLoginMutation, useRegisterMutation, useResetPasswordMutation } from '../../store/api';
import { signedIn, signedOut } from '../../store/session';
import { getLang, t } from '../../i18n';

/*
 * Формы входа и пароля: react-hook-form + схемы из packages/shared (TechBriefing v5, раздел 5).
 * mode 'onTouched': ошибка после первого ухода из поля, дальше при каждом изменении.
 */

const PASSWORD_HINT = t('Не меньше {v0} знаков', { v0: PASSWORD_MIN_CHARS });

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
  const passwordReset = (useLocation().state as { passwordReset?: boolean } | null)?.passwordReset === true;
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
    <AuthCard title={t('Вход')}>
      {passwordReset && (
        <div className="alert alert--info" role="status" data-testid="password-reset-done">
          {t('Пароль изменён. Войдите с новым паролем.')}
        </div>
      )}
      {expired && !passwordReset && (
        <p className="small text-2" role="status">
          {t('Сессия истекла. Войдите снова.')}
        </p>
      )}
      <form className="stack" onSubmit={submit} noValidate>
        <EmailField id="email" label="E-mail" registration={form.register('email')} error={errors.email} />
        <PasswordField id="password" label={t('Пароль')} autoComplete="current-password" registration={form.register('password')} error={errors.password} />
        <FormError message={formError} />
        <SubmitButton submitting={isSubmitting} busyText={t('Входим…')}>
          {t('Войти')}
        </SubmitButton>
      </form>
      <Link to="/forgot" className="link">
        {t('Забыли пароль?')}
      </Link>
      <span className="small text-2">
        {t('Нет аккаунта?')}{' '}
        <Link to="/register" className="link">
          {t('Зарегистрироваться')}
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
    defaultValues: { email: '', password: '', passwordRepeat: '', firstName: '', lastName: '', address: '', aiConsent: false },
  });
  const { errors, isSubmitting } = form.formState;

  const submit = form.handleSubmit(async ({ email, password, consent, aiConsent, firstName, lastName, address }) => {
    setFormError(null);
    try {
      const { sessionToken } = await register({ email, password, consent, aiConsent, firstName, lastName, address, language: getLang() }).unwrap();
      dispatch(signedIn(sessionToken));
      navigate('/app', { replace: true });
    } catch (err) {
      setFormError(applyServerError(err, form.setError, ['email', 'password', 'consent', 'firstName', 'lastName', 'address']));
    }
  });

  return (
    <AuthCard title={t('Регистрация')}>
      <p className="small text-2">{t('Нужны e-mail, пароль, имя, фамилия и адрес проживания. Имя, фамилию и адрес можно изменить в профиле.')}</p>
      <form className="stack" onSubmit={submit} noValidate>
        <TextField
          id="r-first"
          label={t('Имя')}
          autoComplete="given-name"
          registration={form.register('firstName')}
          error={errors.firstName}
          hint={t('Латинскими буквами, например Anna')}
        />
        <TextField
          id="r-last"
          label={t('Фамилия')}
          autoComplete="family-name"
          registration={form.register('lastName')}
          error={errors.lastName}
          hint={t('Латинскими буквами, например Müller')}
        />
        <TextField
          id="r-address"
          label={t('Адрес проживания')}
          autoComplete="street-address"
          registration={form.register('address')}
          error={errors.address}
          hint={t('Улица, дом, индекс, город')}
        />
        <EmailField id="r-email" label="E-mail" registration={form.register('email')} error={errors.email} />
        <PasswordField
          id="r-password"
          label={t('Пароль')}
          autoComplete="new-password"
          registration={form.register('password', { onChange: revalidateIfTouched(form, 'passwordRepeat') })}
          error={errors.password}
          hint={PASSWORD_HINT}
        />
        <PasswordField
          id="r-password2"
          label={t('Повторите пароль')}
          autoComplete="new-password"
          registration={form.register('passwordRepeat')}
          error={errors.passwordRepeat}
        />
        <CheckboxField id="r-consent" registration={form.register('consent')} error={errors.consent}>
          {t('Я согласен(на) с обработкой моих данных по правилам')}{' '}
          <Link to="/datenschutz" className="link" target="_blank">
            Datenschutz
          </Link>
          {t(' и с условиями')}{' '}
          <Link to="/agb" className="link" target="_blank">
            AGB
          </Link>
          {t('. В тестовой версии загружайте только примеры писем.')}
        </CheckboxField>
        {/* K11 (#134): отдельное согласие на анализ ИИ, не отмечено заранее; можно дать позже */}
        <CheckboxField id="r-ai-consent" registration={form.register('aiConsent')}>
          {AI_CONSENT_LABEL}{' '}{t('Необязательно сейчас: без согласия спросим перед первой загрузкой письма.')}
        </CheckboxField>
        <FormError message={formError} />
        <SubmitButton submitting={isSubmitting} busyText={t('Создаём кабинет…')}>
          {t('Зарегистрироваться')}
        </SubmitButton>
      </form>
      <span className="small text-2">
        {t('Уже есть аккаунт?')}{' '}
        <Link to="/login" className="link">
          {t('Войти')}
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

  const sending = useRef(false);
  const submit = form.handleSubmit(async ({ email }) => {
    if (sending.current) return; // повторное нажатие во время запроса
    sending.current = true;
    setFormError(null);
    try {
      await forgotPassword(email).unwrap();
      setSent(true);
    } catch (err) {
      setFormError(applyServerError(err, form.setError, ['email']));
    } finally {
      sending.current = false;
    }
  });

  return (
    <AuthCard title={t('Забыли пароль?')}>
      {sent ? (
        <div className="alert alert--info" role="status">
          {t('Если такой адрес есть, мы отправили письмо со ссылкой. Ссылка работает один раз и около часа.')}
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <p className="small text-2">{t('Введите e-mail, с которым вы регистрировались. Придёт письмо со ссылкой для нового пароля.')}</p>
          <EmailField id="f-email" label="E-mail" registration={form.register('email')} error={errors.email} />
          <FormError message={formError} />
          <SubmitButton submitting={isSubmitting}>{t('Отправить ссылку')}</SubmitButton>
        </form>
      )}
      <Link to="/login" className="link">
        {t('Назад ко входу')}
      </Link>
    </AuthCard>
  );
}

export function ResetPage() {
  const [resetPassword] = useResetPasswordMutation();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { token: session } = useSession();
  // Токен из ссылки живёт только в памяти страницы: из адресной строки и истории он сразу убирается.
  const [token] = useState(() => search.get('token') ?? '');
  useEffect(() => {
    if (search.has('token')) navigate('/reset', { replace: true });
  }, [search, navigate]);
  const [invalid, setInvalid] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof ResetFormSchema>, unknown, z.output<typeof ResetFormSchema>>({
    resolver: zodResolver(ResetFormSchema),
    mode: 'onTouched',
    defaultValues: { newPassword: '', newPasswordRepeat: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const saving = useRef(false);
  const submit = form.handleSubmit(async ({ newPassword }) => {
    if (saving.current) return; // повторное нажатие во время запроса
    saving.current = true;
    setFormError(null);
    try {
      await resetPassword({ token, newPassword }).unwrap();
      // Сервер завершил все сессии: если в этом браузере был вход, он тоже сбрасывается вместе с кэшем.
      if (session) dispatch(signedOut());
      await navigate('/login', { replace: true, state: { passwordReset: true } });
    } catch (err) {
      if (errorCode(err) === 'RESET_TOKEN_INVALID') setInvalid(true);
      else setFormError(applyServerError(err, form.setError, ['newPassword']));
    } finally {
      saving.current = false;
    }
  });

  const again = (
    <Link to="/forgot" className="link">
      {t('Запросить новое письмо')}
    </Link>
  );

  if (!token) {
    return (
      <AuthCard title={t('Новый пароль')}>
        <div className="alert alert--error" role="alert" data-testid="reset-no-token">
          {t('Ссылки нет: страницу открыли без ссылки из письма или обновили. Откройте ссылку из письма ещё раз или запросите новое письмо.')}
        </div>
        {again}
      </AuthCard>
    );
  }

  if (invalid) {
    return (
      <AuthCard title={t('Новый пароль')}>
        <div className="alert alert--error" role="alert" data-testid="reset-invalid">
          {t('Ссылка недействительна или устарела: она работает один раз и ограниченное время. Запросите новое письмо.')}
        </div>
        {again}
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('Новый пароль')}>
      <form className="stack" onSubmit={submit} noValidate>
        <PasswordField
          id="n-pw"
          label={t('Новый пароль')}
          autoComplete="new-password"
          registration={form.register('newPassword', { onChange: revalidateIfTouched(form, 'newPasswordRepeat') })}
          error={errors.newPassword}
          hint={PASSWORD_HINT}
        />
        <PasswordField
          id="n-pw2"
          label={t('Повторите пароль')}
          autoComplete="new-password"
          registration={form.register('newPasswordRepeat')}
          error={errors.newPasswordRepeat}
        />
        <FormError message={formError} />
        <SubmitButton submitting={isSubmitting}>{t('Сохранить пароль')}</SubmitButton>
      </form>
      {again}
    </AuthCard>
  );
}
