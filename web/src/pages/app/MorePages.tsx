import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_CHARS } from '@jasno/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormError, PasswordField, SubmitButton } from '../../components/form';
import { ChangePasswordFormSchema, DeleteAccountFormSchema } from '../../forms/schemas';
import { applyServerError } from '../../forms/serverErrors';
import { useNavigate } from 'react-router';
import { useAppDispatch } from '../../store';
import { useCabinetQuery, useChangePasswordMutation, useDeleteAccountMutation, useLogoutMutation } from '../../store/api';
import { signedOut } from '../../store/session';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { DemoNote, ErrorAlert, Loading, PageHeader } from '../../components/ui';

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
  const dispatch = useAppDispatch();
  const signOut = () => dispatch(signedOut());
  const [changePasswordReq] = useChangePasswordMutation();
  const [deleteAccountReq] = useDeleteAccountMutation();
  const [logoutReq] = useLogoutMutation();
  const navigate = useNavigate();
  const cabinet = useCabinetQuery();

  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const pwForm = useForm<z.input<typeof ChangePasswordFormSchema>, unknown, z.output<typeof ChangePasswordFormSchema>>({
    resolver: zodResolver(ChangePasswordFormSchema),
    mode: 'onTouched',
    defaultValues: { oldPassword: '', newPassword: '', newPasswordRepeat: '' },
  });

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  const delForm = useForm<z.input<typeof DeleteAccountFormSchema>, unknown, z.output<typeof DeleteAccountFormSchema>>({
    resolver: zodResolver(DeleteAccountFormSchema),
    mode: 'onTouched',
    defaultValues: { password: '' },
  });

  const changePassword = pwForm.handleSubmit(async ({ oldPassword, newPassword }) => {
    setPwMsg(null);
    setPwErr(null);
    try {
      await changePasswordReq({ oldPassword, newPassword }).unwrap();
      setPwMsg('Пароль изменён. На других устройствах нужно войти заново.');
      pwForm.reset();
    } catch (err) {
      setPwErr(applyServerError(err, pwForm.setError, ['oldPassword', 'newPassword']));
    }
  });

  const deleteAccount = delForm.handleSubmit(async ({ password }) => {
    setDelErr(null);
    try {
      await deleteAccountReq(password).unwrap();
      // Сначала уйти с закрытой страницы (flushSync: сразу), иначе она сама перенаправит на вход.
      await navigate('/', { replace: true, flushSync: true });
      signOut();
    } catch (err) {
      setDelErr(applyServerError(err, delForm.setError, ['password']));
    }
  });

  async function logout() {
    try {
      await logoutReq().unwrap();
    } finally {
      // Сначала уйти с закрытой страницы (flushSync: сразу), иначе она сама перенаправит на вход.
      await navigate('/', { replace: true, flushSync: true });
      signOut();
    }
  }

  if (cabinet.isLoading) return <Loading />;
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
            <PasswordField
              id="pw-old"
              label="Старый пароль"
              autoComplete="current-password"
              registration={pwForm.register('oldPassword')}
              error={pwForm.formState.errors.oldPassword}
            />
            <PasswordField
              id="pw-new"
              label="Новый пароль"
              autoComplete="new-password"
              registration={pwForm.register('newPassword', { deps: ['newPasswordRepeat'] })}
              error={pwForm.formState.errors.newPassword}
              hint={`Не меньше ${PASSWORD_MIN_CHARS} знаков`}
            />
            <PasswordField
              id="pw-new2"
              label="Повторите новый пароль"
              autoComplete="new-password"
              registration={pwForm.register('newPasswordRepeat')}
              error={pwForm.formState.errors.newPasswordRepeat}
            />
            {pwMsg && (
              <div className="alert alert--info" role="status">
                {pwMsg}
              </div>
            )}
            <FormError message={pwErr} />
            <SubmitButton submitting={pwForm.formState.isSubmitting} className="btn btn--navy btn--small">
              Сменить пароль
            </SubmitButton>
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
                <PasswordField
                  id="del-pw"
                  label="Введите пароль для подтверждения"
                  autoComplete="current-password"
                  registration={delForm.register('password')}
                  error={delForm.formState.errors.password}
                />
                <FormError message={delErr} />
                <div className="row wrap">
                  <SubmitButton submitting={delForm.formState.isSubmitting} className="btn btn--danger btn--small">
                    Удалить навсегда
                  </SubmitButton>
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
