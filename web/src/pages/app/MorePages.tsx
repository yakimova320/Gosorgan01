import { useState, type FormEvent } from 'react';
import { api } from '../../api';
import { useRouter } from '../../app/router';
import { useSession } from '../../app/session';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { DemoNote, ErrorAlert, Loading, PageHeader } from '../../components/ui';
import { useAsync } from '../../lib/useAsync';

/** «Спросить»: чат-помощник (C01–C03, после демо). Пока экран-оболочка. */
export function AskPage() {
  return (
    <>
      <PageHeader title="Спросить" subtitle="Помощник отвечает на вопросы о Ja!sno и подсказывает, где что найти. Письма он не разбирает." />
      <div className="card card--teal">
        <Illustration name="talk" height={160} blob="#BFE0DB" />
      </div>
      <div className="stack" aria-live="polite">
        <div className="chat-bubble chat-bubble--me">Где моё письмо от Jobcenter?</div>
        <div className="chat-bubble chat-bubble--bot">Оно в деле «Jobcenter: выписки со счёта». Там же объяснение и черновик ответа.</div>
      </div>
      <DemoNote>Пример разговора. Чат-помощник подключается после демо (задачи C01–C03)</DemoNote>
      <div className="row">
        <input className="input" placeholder="Ваш вопрос…" disabled aria-label="Ваш вопрос" />
        <button type="button" className="btn btn--primary btn--small" disabled aria-label="Отправить">
          <Icon name="send" size={18} color="#FFFFFF" />
        </button>
      </div>
    </>
  );
}

const TEMPLATES = [
  'Сообщить о смене адреса',
  'Попросить копию документа',
  'Сообщить о новой работе',
  'Попросить встречу',
  'Сообщить о болезни',
  'Отозвать заявление',
];

/** «Написать письмо самому» (B16, если останется время). */
export function WritePage() {
  return (
    <>
      <PageHeader title="Написать письмо" subtitle="Письмо в ведомство по готовому шаблону: Ja!sno переведёт и проверит." />
      <DemoNote>Скоро. Шаблоны собственных писем делаются, если останется время (задача B16)</DemoNote>
      <ul className="list-reset grid-2">
        {TEMPLATES.map((t) => (
          <li key={t} className="card stack-s" style={{ opacity: 0.7 }}>
            <Icon name="doc" color="var(--c-teal)" />
            <span style={{ fontWeight: 600 }}>{t}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ProfilePage() {
  const { token, signOut } = useSession();
  const { navigate } = useRouter();
  const cabinet = useAsync(() => api.cabinet(token), [token]);

  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<unknown>(null);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delErr, setDelErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    setPwErr(null);
    if (newPw.length < 10) return setPwMsg('Новый пароль: не меньше 10 знаков');
    if (newPw !== newPw2) return setPwMsg('Пароли не совпадают');
    setBusy(true);
    try {
      await api.changePassword(token, oldPw, newPw);
      setPwMsg('Пароль изменён. На других устройствах нужно войти заново.');
      setOldPw('');
      setNewPw('');
      setNewPw2('');
    } catch (err) {
      setPwErr(err);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault();
    if (!delPw) return;
    setBusy(true);
    setDelErr(null);
    try {
      await api.deleteAccount(token, delPw);
      signOut();
      navigate('/', { replace: true });
    } catch (err) {
      setDelErr(err);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api.logout(token);
    } finally {
      signOut();
      navigate('/', { replace: true });
    }
  }

  if (cabinet.loading) return <Loading />;
  const p = cabinet.data?.profile;

  return (
    <>
      <PageHeader title="Профиль" />
      <ErrorAlert error={cabinet.error} />
      <div className="desktop-2col stack">
        <section className="card stack">
          <h2 style={{ fontSize: 19 }}>Мои данные</h2>
          <p className="muted">Нужны только для черновика ответа: имя и адрес отправителя.</p>
          <div className="field">
            <label htmlFor="p-name">Имя и фамилия</label>
            <input id="p-name" className="input" defaultValue={[p?.firstName, p?.lastName].filter(Boolean).join(' ')} disabled />
          </div>
          <div className="field">
            <label htmlFor="p-addr">Адрес</label>
            <input id="p-addr" className="input" defaultValue={p?.address ?? ''} disabled />
          </div>
          <div className="field">
            <label htmlFor="p-email">E-mail</label>
            <input id="p-email" className="input" value={cabinet.data?.email ?? ''} readOnly />
          </div>
          <DemoNote>Сохранение профиля подключается в задаче F05</DemoNote>
          <div className="field">
            <label htmlFor="p-lang">Язык</label>
            <select id="p-lang" className="select" value="ru" disabled>
              <option value="ru">Русский</option>
            </select>
            <span className="muted">Украинский и простой немецкий появятся позже.</span>
          </div>
        </section>

        <section className="stack">
          <h2 style={{ fontSize: 19 }}>
            <Icon name="lock" size={20} /> Данные и безопасность
          </h2>
          <form className="card stack" onSubmit={changePassword} noValidate>
            <h3>Сменить пароль</h3>
            <div className="field">
              <label htmlFor="pw-old">Старый пароль</label>
              <input id="pw-old" className="input" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pw-new">Новый пароль</label>
              <input id="pw-new" className="input" type="password" autoComplete="new-password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pw-new2">Повторите новый пароль</label>
              <input id="pw-new2" className="input" type="password" autoComplete="new-password" value={newPw2} onChange={(e) => setNewPw2(e.target.value)} />
            </div>
            {pwMsg && <div className="alert alert--info">{pwMsg}</div>}
            <ErrorAlert error={pwErr} />
            <button type="submit" className="btn btn--navy btn--small" disabled={busy || !oldPw || !newPw}>
              Сменить пароль
            </button>
          </form>

          <div className="card stack">
            <h3>Удалить аккаунт</h3>
            <p className="small text-2">
              Удаляются все дела, письма, файлы и записи журнала. Ja!sno ничего не сохраняет. Восстановить данные нельзя.
            </p>
            {!confirmDelete ? (
              <button type="button" className="btn btn--danger btn--small" onClick={() => setConfirmDelete(true)}>
                <Icon name="trash" size={16} /> Удалить аккаунт
              </button>
            ) : (
              <form className="stack" onSubmit={deleteAccount} noValidate>
                <div className="alert alert--error">Вы уверены? Это нельзя отменить.</div>
                <div className="field">
                  <label htmlFor="del-pw">Введите пароль для подтверждения</label>
                  <input id="del-pw" className="input" type="password" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
                </div>
                <ErrorAlert error={delErr} />
                <div className="row wrap">
                  <button type="submit" className="btn btn--danger btn--small" disabled={busy || !delPw}>
                    Удалить навсегда
                  </button>
                  <button type="button" className="btn btn--ghost btn--small" onClick={() => setConfirmDelete(false)}>
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>

          <button type="button" className="btn btn--secondary" onClick={logout}>
            <Icon name="logout" size={18} /> Выйти
          </button>
        </section>
      </div>
    </>
  );
}
