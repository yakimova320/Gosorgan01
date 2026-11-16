import { useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../../api';
import { Link, useRouter } from '../../app/router';
import { useSession } from '../../app/session';
import { ErrorAlert } from '../../components/ui';

const PASSWORD_MIN = 10;
const PASSWORD_MAX_BYTES = 72; // предел bcrypt, ТЗ v4 раздел 9

function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Пароль: не меньше ${PASSWORD_MIN} знаков`;
  if (new TextEncoder().encode(pw).length > PASSWORD_MAX_BYTES) return 'Пароль слишком длинный (русские буквы считаются за два знака, максимум около 36 букв)';
  return null;
}

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card stack" style={{ maxWidth: 440, width: '100%', margin: '12px auto 0', padding: 22 }}>
      <h1 style={{ fontSize: 26 }}>{title}</h1>
      {children}
    </div>
  );
}

export function LoginPage() {
  const { signIn, expired } = useSession();
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { sessionToken } = await api.login({ email: email.trim().toLowerCase(), password });
      signIn(sessionToken);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Вход">
      {expired && (
        <p className="small text-2" role="status">
          Сессия истекла. Войдите снова.
        </p>
      )}
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" className="input" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Пароль</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <ErrorAlert error={error} />
        <button className="btn btn--primary" type="submit" disabled={busy || !email || !password}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
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
  const { signIn } = useSession();
  const { navigate } = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const pwProblem = passwordProblem(password);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (busy || pwProblem || !emailOk || !consent) return;
    setBusy(true);
    setError(null);
    try {
      const { sessionToken } = await api.register({ email: email.trim().toLowerCase(), password, consent });
      signIn(sessionToken);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Регистрация">
      <p className="small text-2">Нужны только e-mail и пароль. Имя, адрес и номера документов Ja!sno не спрашивает.</p>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="r-email">E-mail</label>
          <input id="r-email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={touched && !emailOk} />
          {touched && !emailOk && <span className="field-error">Проверьте e-mail</span>}
        </div>
        <div className="field">
          <label htmlFor="r-password">Пароль</label>
          <input id="r-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={touched && !!pwProblem} aria-describedby="pw-hint" />
          <span id="pw-hint" className={touched && pwProblem ? 'field-error' : 'muted'}>
            {touched && pwProblem ? pwProblem : `Не меньше ${PASSWORD_MIN} знаков`}
          </span>
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            Я согласен(на) с обработкой моих данных по правилам Datenschutz. В тестовой версии загружайте только примеры писем.
          </span>
        </label>
        {touched && !consent && <span className="field-error">Без согласия регистрация невозможна</span>}
        <ErrorAlert error={error} />
        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Создаём кабинет…' : 'Зарегистрироваться'}
        </button>
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
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !email) return;
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Забыли пароль?">
      {sent ? (
        <div className="alert alert--info" role="status">
          Если такой адрес есть, мы отправили письмо со ссылкой. Ссылка работает один раз и около часа.
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          <p className="small text-2">Введите e-mail, с которым вы регистрировались. Придёт письмо со ссылкой для нового пароля.</p>
          <div className="field">
            <label htmlFor="f-email">E-mail</label>
            <input id="f-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <ErrorAlert error={error} />
          <button className="btn btn--primary" type="submit" disabled={busy || !email}>
            Отправить ссылку
          </button>
        </form>
      )}
      <Link to="/login" className="link">
        Назад ко входу
      </Link>
    </AuthCard>
  );
}

export function ResetPage() {
  const { search, navigate } = useRouter();
  const token = search.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const problem = passwordProblem(pw) ?? (pw !== pw2 ? 'Пароли не совпадают' : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (busy || problem) return;
    setBusy(true);
    setError(null);
    try {
      await api.resetPassword(token, pw);
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

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
        <div className="field">
          <label htmlFor="n-pw">Новый пароль</label>
          <input id="n-pw" className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="n-pw2">Повторите пароль</label>
          <input id="n-pw2" className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        {touched && problem && <span className="field-error">{problem}</span>}
        <ErrorAlert error={error} />
        <button className="btn btn--primary" type="submit" disabled={busy}>
          Сохранить пароль
        </button>
      </form>
      <Link to="/forgot" className="link">
        Запросить новое письмо
      </Link>
    </AuthCard>
  );
}
