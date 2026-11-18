import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MIN_CHARS } from '@jasno/shared';
import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormError, PasswordField, SubmitButton, TextField } from '../../components/form';
import { ChangePasswordFormSchema, DeleteAccountFormSchema, ProfileFormSchema } from '../../forms/schemas';
import { applyServerError } from '../../forms/serverErrors';
import { revalidateIfTouched } from '../../forms/revalidate';
import { errorCode } from '../../api/errors';
import { useNavigate } from 'react-router';
import { useAppDispatch } from '../../store';
import {
  useCabinetQuery,
  useChangePasswordMutation,
  useDeleteAccountMutation,
  useLogoutMutation,
  useUpdateProfileMutation,
} from '../../store/api';
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

  const changing = useRef(false);
  const changePassword = pwForm.handleSubmit(async ({ oldPassword, newPassword }) => {
    if (changing.current) return; // повторное нажатие во время запроса
    changing.current = true;
    setPwMsg(null);
    setPwErr(null);
    try {
      await changePasswordReq({ oldPassword, newPassword }).unwrap();
      setPwMsg('Пароль изменён. На других устройствах нужно войти заново.');
      pwForm.reset();
    } catch (err) {
      // неверный текущий пароль: ошибка у поля, сессия остаётся
      if (errorCode(err) === 'INVALID_CREDENTIALS')
        pwForm.setError('oldPassword', { type: 'server', message: 'Неверный пароль' }, { shouldFocus: true });
      else setPwErr(applyServerError(err, pwForm.setError, ['oldPassword', 'newPassword']));
    } finally {
      changing.current = false;
    }
  });

  const deleting = useRef(false);
  const deleteAccount = delForm.handleSubmit(async ({ password }) => {
    if (deleting.current) return; // повторное нажатие во время запроса
    deleting.current = true;
    setDelErr(null);
    try {
      const { pending } = await deleteAccountReq(password).unwrap();
      // Сначала уйти с закрытой страницы (flushSync: сразу), иначе она сама перенаправит на вход.
      // Выход сбрасывает сессию и весь кэш (store/index.ts).
      await navigate('/', {
        replace: true,
        flushSync: true,
        state: { accountDeleted: pending ? 'pending' : 'done' },
      });
      signOut();
    } catch (err) {
      // неверный пароль: ошибка у поля, сессия остаётся
      if (errorCode(err) === 'INVALID_CREDENTIALS')
        delForm.setError('password', { type: 'server', message: 'Неверный пароль' }, { shouldFocus: true });
      else setDelErr(applyServerError(err, delForm.setError, ['password']));
    } finally {
      deleting.current = false;
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
          <p className="muted">Имя, фамилия и адрес нужны для черновика ответа: это данные отправителя.</p>
          {p && <ProfileForm key={cabinet.data?.email} profile={p} />}
          <div className="field">
            <label htmlFor="p-email">E-mail</label>
            <input id="p-email" className="input" value={cabinet.data?.email ?? ''} readOnly />
          </div>
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
              registration={pwForm.register('newPassword', { onChange: revalidateIfTouched(pwForm, 'newPasswordRepeat') })}
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

type ProfileForm = z.input<typeof ProfileFormSchema>;

/** Имя, фамилия, адрес. На сервер уходят только изменённые поля, сервер проверяет итог целиком. */
function ProfileForm({ profile }: { profile: { firstName?: string; lastName?: string; address?: string } }) {
  const [updateProfile] = useUpdateProfileMutation();
  const [saved, setSaved] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ProfileForm, unknown, z.output<typeof ProfileFormSchema>>({
    resolver: zodResolver(ProfileFormSchema),
    mode: 'onTouched',
    defaultValues: { firstName: profile.firstName ?? '', lastName: profile.lastName ?? '', address: profile.address ?? '' },
  });
  const { errors, isSubmitting, dirtyFields } = form.formState;

  const submit = form.handleSubmit(async (values) => {
    setSaved(false);
    setFormError(null);
    const changed = Object.fromEntries(
      (Object.keys(values) as (keyof ProfileForm)[]).filter((k) => dirtyFields[k]).map((k) => [k, values[k]]),
    );
    if (Object.keys(changed).length === 0) return setSaved(true);
    try {
      const cabinet = await updateProfile(changed).unwrap();
      form.reset({
        firstName: cabinet.profile?.firstName ?? '',
        lastName: cabinet.profile?.lastName ?? '',
        address: cabinet.profile?.address ?? '',
      });
      setSaved(true);
    } catch (err) {
      setFormError(applyServerError(err, form.setError, ['firstName', 'lastName', 'address'], 'profile.'));
    }
  });

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <TextField id="p-first" label="Имя" autoComplete="given-name" registration={form.register('firstName')} error={errors.firstName} />
      <TextField id="p-last" label="Фамилия" autoComplete="family-name" registration={form.register('lastName')} error={errors.lastName} />
      <TextField id="p-address" label="Адрес проживания" autoComplete="street-address" registration={form.register('address')} error={errors.address} />
      {saved && (
        <div className="alert alert--info" role="status">
          Сохранено
        </div>
      )}
      <FormError message={formError} />
      <SubmitButton submitting={isSubmitting} className="btn btn--navy btn--small">
        Сохранить
      </SubmitButton>
    </form>
  );
}
