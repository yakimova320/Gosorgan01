import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { API_URL } from '../api/config';
import { errorText } from '../api/errors';
import {
  useCalendarSettingsQuery,
  useRemoveCalendarLinkMutation,
  useResetCalendarLinkMutation,
  useSetReminderEmailMutation,
} from '../store/api';
import { t } from '../i18n';

/** Полный адрес ленты: адрес API (абсолютный или относительный) + /calendar/<токен>.ics */
export function feedUrl(feedPath: string, apiUrl: string = API_URL, origin: string = window.location.origin): string {
  return new URL(`${apiUrl.replace(/\/+$/, '')}${feedPath}`, origin).toString();
}

/** webcal:// — так подписку открывают календари iPhone и Mac. */
export function webcalUrl(url: string): string {
  return url.replace(/^https?:\/\//, 'webcal://');
}

/** Google Календарь: «Добавить календарь по URL» через параметр cid. */
export function googleCalendarUrl(url: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(url))}`;
}

/**
 * K12: блок «Календарь и напоминания». KORR 25.11: стоит в кабинете (/app#calendar), не в профиле.
 * Ссылка-подписка со всеми действующими сроками и выключатель письма за 3 дня до срока.
 */
export function CalendarSection() {
  const settings = useCalendarSettingsQuery();
  const [resetLink, resetState] = useResetCalendarLinkMutation();
  const [removeLink, removeState] = useRemoveCalendarLinkMutation();
  const [setReminder, reminderState] = useSetReminderEmailMutation();
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const { hash } = useLocation();
  const data = settings.data;

  // ссылка из профиля: /app#calendar
  useEffect(() => {
    if (hash === '#calendar' && data) document.getElementById('calendar')?.scrollIntoView?.({ block: 'start' });
  }, [hash, data]);
  const url = data?.feedPath ? feedUrl(data.feedPath) : null;
  const busy = resetState.isLoading || removeState.isLoading;
  const error = settings.error ?? resetState.error ?? removeState.error ?? reminderState.error;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div id="calendar" className="card stack-s" role="group" aria-labelledby="calendar-title" data-testid="calendar-profile">
      <h3 id="calendar-title">{t('Календарь и напоминания')}</h3>
      <p className="small text-2">
        {t('Сроки из ваших писем появятся в календаре телефона: Google, iPhone или Outlook. В календаре только дата, вид срока, ведомство и название дела, без текста письма.')}
      </p>

      {error && (
        <div className="alert alert--error" role="alert">
          {errorText(error)}
        </div>
      )}

      {data && !url && (
        <button
          type="button"
          className="btn btn--primary btn--small"
          disabled={busy}
          onClick={() => void resetLink()}
        >
          {resetState.isLoading ? t('Создаём…') : t('Создать ссылку для календаря')}
        </button>
      )}

      {url && (
        <>
          <div className="field">
            <label htmlFor="calendar-url">{t('Ваша ссылка на календарь')}</label>
            <input
              id="calendar-url"
              className="input"
              value={url}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              aria-describedby="calendar-url-hint"
            />
            <span id="calendar-url-hint" className="muted small">
              {t('Ссылка личная: кто её знает, видит ваши сроки. Не пересылайте её.')}
            </span>
          </div>
          <div className="row wrap">
            <a className="btn btn--primary btn--small" href={googleCalendarUrl(url)} target="_blank" rel="noreferrer">
              {t('Добавить в Google Календарь')}
            </a>
            <a className="btn btn--secondary btn--small" href={webcalUrl(url)}>
              {t('Календарь iPhone или Mac')}
            </a>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => void copy()}>
              {copied ? t('Скопировано') : t('Скопировать ссылку')}
            </button>
          </div>
          <p className="small text-2">
            {t('Google Календарь обновляет подписку сам, обычно раз в несколько часов. Новый срок появится не сразу.')}
          </p>
          {!confirmReset ? (
            <div className="row wrap">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={busy}
                onClick={() => setConfirmReset(true)}
              >
                {t('Новая ссылка')}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                disabled={busy}
                onClick={() => void removeLink()}
              >
                {t('Отключить календарь')}
              </button>
            </div>
          ) : (
            <div className="stack-s">
              <div className="alert alert--info" role="status">
                {t('Старая ссылка перестанет работать. Календарь нужно будет добавить заново.')}
              </div>
              <div className="row wrap">
                <button
                  type="button"
                  className="btn btn--navy btn--small"
                  disabled={busy}
                  onClick={() => void resetLink().then(() => setConfirmReset(false))}
                >
                  {t('Создать новую ссылку')}
                </button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setConfirmReset(false)}>
                  {t('Отмена')}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {data && (
        <div className="field">
          <label className="checkbox" htmlFor="reminder-email">
            <input
              id="reminder-email"
              type="checkbox"
              checked={data.reminderEmail}
              disabled={reminderState.isLoading}
              onChange={(e) => void setReminder(e.target.checked)}
            />
            <span>{t('Напоминать письмом за 3 дня до срока')}</span>
          </label>
        </div>
      )}
    </div>
  );
}
