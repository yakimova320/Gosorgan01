import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DATA_MODE } from '../api/config';
import {
  encryptLegacy,
  initKeyring,
  keyring,
  newRecoverySecret,
  setupVault,
  unlockVault,
} from '../crypto/keyring';
import { t } from '../i18n';
import { api } from '../store/api';
import { useStore } from 'react-redux';
import { useAppDispatch, useSession, type RootState } from '../store';
import { Loading } from './ui';

/*
 * E01 (#163): кабинет открывается только с открытым архивом.
 * - Ключа архива ещё нет: экран создания. Секрет восстановления создаётся здесь, в браузере,
 *   показывается один раз и до первой загрузки объясняется, что без него архив не открыть.
 * - Ключ есть, устройство новое: экран «Откройте архив» (ввод секрета).
 * - Устройство уже разблокировано: сразу кабинет.
 * Письма и дела, загруженные до шифрования, шифруются в фоне после открытия.
 * В режиме mock (без сервера) экран не нужен.
 */
export function VaultGate({ children }: { children: ReactNode }) {
  if (DATA_MODE === 'mock') return <>{children}</>;
  return <ApiVaultGate>{children}</ApiVaultGate>;
}

const ALL_TAGS = ['Cabinet', 'Case', 'History', 'Letters', 'Letter', 'Draft', 'Chat', 'Calendar'] as const;

function ApiVaultGate({ children }: { children: ReactNode }) {
  const { token } = useSession();
  const dispatch = useAppDispatch();
  // токен для запросов ключей — из того store, который показывает этот экран
  // (в StrictMode фабрика store вызывается дважды)
  const store = useStore<RootState>();
  keyring.configure({ getToken: () => store.getState().session.token });
  const vault = useSyncExternalStore(keyring.subscribe, keyring.snapshot);

  useEffect(() => {
    if (token && vault.status === 'unknown') void initKeyring();
  }, [token, vault.status]);

  useEffect(() => {
    if (vault.status !== 'unlocked' || vault.legacy === 0) return;
    void encryptLegacy().then(() => dispatch(api.util.invalidateTags([...ALL_TAGS])));
  }, [vault.status, vault.legacy, dispatch]);

  switch (vault.status) {
    case 'unlocked':
      return (
        <>
          <span data-testid="vault-open" hidden />
          {children}
        </>
      );
    case 'none':
      return <SetupVault />;
    case 'locked':
      return <UnlockVault />;
    case 'error':
      return (
        <div className="card stack" role="alert" data-testid="vault-error">
          <p>{t('Не получилось проверить ключ архива. Проверьте интернет и попробуйте ещё раз.')}</p>
          <button type="button" className="btn btn--secondary" onClick={() => void initKeyring()}>
            {t('Попробовать ещё раз')}
          </button>
        </div>
      );
    default:
      return <Loading text={t('Открываем архив…')} />;
  }
}

function SetupVault() {
  const [secret, setSecret] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void newRecoverySecret().then((s) => alive && setSecret(s));
    return () => {
      alive = false;
    };
  }, []);

  async function create() {
    if (!secret || !saved) return;
    setBusy(true);
    setError(false);
    try {
      await setupVault(secret);
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  function download() {
    if (!secret) return;
    const text = `Ja!sno — ${t('секрет восстановления архива')}\n\n${secret}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'jasno-recovery-secret.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card stack" data-testid="vault-setup" style={{ maxWidth: 640 }}>
      <h1>{t('Ключ вашего архива')}</h1>
      <p>
        {t('Ja!sno шифрует письма прямо в браузере. На сервере лежит только шифротекст: ни мы, ни база данных не можем прочитать ваш архив.')}
      </p>
      <p>
        {t('Секрет восстановления — единственный способ открыть архив на новом устройстве. Ja!sno его не хранит и не сможет восстановить. Сброс пароля архив не открывает.')}
      </p>
      <p className="alert alert--warn">
        {t('Если потерять секрет и все устройства, где архив открыт, письма будут потеряны навсегда.')}
      </p>
      {secret ? (
        <div className="stack-s">
          <span className="small text-2" id="recovery-secret-label">
            {t('Ваш секрет восстановления')}
          </span>
          <code
            data-testid="recovery-secret"
            aria-labelledby="recovery-secret-label"
            style={{ fontSize: 16, wordBreak: 'break-all', padding: 12, borderRadius: 12, background: 'var(--surface-2, #F3EDE3)' }}
          >
            {secret}
          </code>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => void navigator.clipboard?.writeText(secret).then(() => setCopied(true))}
            >
              {copied ? t('Скопировано') : t('Скопировать')}
            </button>
            <button type="button" className="btn btn--secondary btn--small" onClick={download}>
              {t('Скачать файлом')}
            </button>
          </div>
        </div>
      ) : (
        <Loading text={t('Создаём секрет…')} />
      )}
      <label className="checkbox" htmlFor="vault-saved">
        <input id="vault-saved" type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        <span>{t('Я сохранил(а) секрет восстановления в надёжном месте')}</span>
      </label>
      {error && (
        <div className="alert alert--error" role="alert">
          {t('Не получилось создать ключ архива. Попробуйте ещё раз.')}
        </div>
      )}
      <button
        type="button"
        className="btn btn--primary"
        data-testid="vault-create"
        disabled={!secret || !saved || busy}
        aria-busy={busy || undefined}
        onClick={() => void create()}
      >
        {busy ? t('Создаём ключ…') : t('Создать ключ архива')}
      </button>
    </section>
  );
}

function UnlockVault() {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);
  const empty = value.trim() === '';
  const error = wrong
    ? t('Секрет не подходит. Проверьте, нет ли опечатки')
    : touched && empty
      ? t('Введите секрет восстановления')
      : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (empty) return;
    setBusy(true);
    setWrong(false);
    try {
      if (!(await unlockVault(value))) setWrong(true);
    } catch {
      setWrong(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" data-testid="vault-unlock" style={{ maxWidth: 640 }} onSubmit={(e) => void submit(e)} noValidate>
      <h1>{t('Откройте архив')}</h1>
      <p>
        {t('На этом устройстве архив ещё не открыт. Введите секрет восстановления, который вы сохранили при создании ключа архива.')}
      </p>
      <div className="field">
        <label htmlFor="recovery-secret">{t('Секрет восстановления')}</label>
        <textarea
          id="recovery-secret"
          rows={3}
          autoComplete="off"
          spellCheck={false}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'recovery-secret-error' : undefined}
          onBlur={() => setTouched(true)}
          onChange={(e) => {
            setValue(e.target.value);
            setWrong(false);
          }}
        />
        {error && (
          <span className="field-error" id="recovery-secret-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <button type="submit" className="btn btn--primary" data-testid="vault-unlock-submit" disabled={busy} aria-busy={busy || undefined}>
        {busy ? t('Открываем…') : t('Открыть архив')}
      </button>
      <details>
        <summary>{t('Потеряли секрет?')}</summary>
        <p className="small text-2">
          {t('Без секрета архив не открыть: Ja!sno не хранит ключей. Если архив открыт на другом устройстве, откройте его там. Иначе письма придётся загрузить заново в новом аккаунте.')}
        </p>
      </details>
    </form>
  );
}
