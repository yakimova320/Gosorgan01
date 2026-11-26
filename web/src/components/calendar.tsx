import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { errorCode, errorText } from '../api/errors';
import {
  useCalendarSettingsQuery,
  useCasesQuery,
  useRemoveCalendarLinkMutation,
  useSetReminderEmailMutation,
} from '../store/api';
import { daysUntil, deadlineText, formatDate, todayBerlin } from '../lib/dates';
import { Icon } from './Icon';
import { t } from '../i18n';

/** Следующий день ГГГГ-ММ-ДД: у события на весь день в Google конец не включается. */
function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface GoogleEvent {
  /** ГГГГ-ММ-ДД */
  date: string;
  title: string;
  details: string;
}

/**
 * Google Календарь: открыть новое событие на весь день, уже заполненное.
 * Человеку остаётся нажать «Сохранить». Нашему серверу не нужно быть доступным из интернета.
 */
export function googleEventUrl(e: GoogleEvent): string {
  const compact = (iso: string) => iso.replace(/-/g, '');
  return (
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(e.title)}` +
    `&dates=${compact(e.date)}/${compact(nextDay(e.date))}` +
    `&details=${encodeURIComponent(e.details)}`
  );
}

/**
 * Текст события срока: как в ленте и письме-напоминании (вид срока, ведомство, дело, ссылка).
 * Текста письма и личных номеров здесь нет.
 */
export function deadlineEvent(
  d: { date: string; kind?: string | null; authority?: string | null; caseTitle: string; caseId: string },
  origin: string = window.location.origin,
): GoogleEvent {
  const what = d.kind ? (DEADLINE_WHAT[d.kind] ?? t('срок')) : null;
  const title = [t('Срок'), what ? `: ${what}` : '', d.authority ? ` — ${d.authority}` : ''].join('');
  const details = [
    t('Дело: {v0}', { v0: d.caseTitle }),
    t('Срок из письма, подтверждённый в Ja!sno. Проверьте дату по оригиналу письма.'),
    `${origin.replace(/\/+$/, '')}/app/cases/${d.caseId}`,
  ].join('\n');
  return { date: d.date, title, details };
}

const DEADLINE_WHAT: Record<string, string> = {
  REPLY: t('ответить'),
  DOCUMENTS: t('прислать документы'),
  OBJECTION: t('возражение'),
  FOLLOW_UP: t('напоминание'),
};

/** Кнопка «В Google Календарь»: новая вкладка с готовым событием. */
export function GoogleEventButton({ event, label }: { event: GoogleEvent; label?: string }) {
  return (
    <a className="btn btn--ghost btn--small" href={googleEventUrl(event)} target="_blank" rel="noreferrer">
      <Icon name="calendar" size={16} />{' '}{label ?? t('В Google Календарь')}
    </a>
  );
}

/**
 * K12, поправка 26.11: блок «Календарь и напоминания» в кабинете (/app#calendar).
 * Ближайшие сроки дел с кнопкой «В Google Календарь» и выключатель письма за 3 дня до срока.
 * Подписка-лента .ics с сайта убрана: Google не может скачать её с локального адреса
 * и обновляет её часами. Старую ссылку, если она была, можно отключить.
 */
export function CalendarSection() {
  const settings = useCalendarSettingsQuery();
  const cases = useCasesQuery();
  const [removeLink, removeState] = useRemoveCalendarLinkMutation();
  const [setReminder, reminderState] = useSetReminderEmailMutation();

  const { hash } = useLocation();
  const data = settings.data;

  // ссылка из профиля: /app#calendar
  useEffect(() => {
    if (hash === '#calendar' && data) document.getElementById('calendar')?.scrollIntoView?.({ block: 'start' });
  }, [hash, data]);

  const today = todayBerlin();
  const upcoming = (cases.data ?? [])
    .filter((c) => c.stage !== 'CLOSED' && c.nextDeadline && daysUntil(c.nextDeadline, today) >= 0)
    .sort((a, b) => (a.nextDeadline! < b.nextDeadline! ? -1 : 1));
  const casesError = errorCode(cases.error) === 'NOT_CONNECTED' ? null : cases.error;
  const error = settings.error ?? casesError ?? removeState.error ?? reminderState.error;

  return (
    <div id="calendar" className="card stack-s" role="group" aria-labelledby="calendar-title" data-testid="calendar-profile">
      <h3 id="calendar-title">{t('Календарь и напоминания')}</h3>
      <p className="small text-2">
        {t('Нажмите «В Google Календарь» у срока: откроется Google Календарь с готовым событием, останется нажать «Сохранить». В событии только дата, вид срока, ведомство и название дела, без текста письма.')}
      </p>

      {error && (
        <div className="alert alert--error" role="alert">
          {errorText(error)}
        </div>
      )}

      {cases.data && upcoming.length === 0 && <p className="small muted">{t('Ближайших сроков пока нет.')}</p>}

      {upcoming.length > 0 && (
        <ul className="list-reset stack-s" aria-label={t('Ближайшие сроки')}>
          {upcoming.map((c) => (
            <li key={c.id} className="row-between wrap deadline-item" data-testid="calendar-deadline">
              <span className="stack-s" style={{ gap: 2 }}>
                <span style={{ fontWeight: 700 }}>
                  {t('до')}{' '}{formatDate(c.nextDeadline!)}
                </span>
                <span className="small text-2">
                  {c.title} · {deadlineText(c.nextDeadline!, today)}
                </span>
              </span>
              <GoogleEventButton
                event={deadlineEvent({
                  date: c.nextDeadline!,
                  authority: c.authority,
                  caseTitle: c.title,
                  caseId: c.id,
                })}
              />
            </li>
          ))}
        </ul>
      )}

      {data?.feedPath && (
        <div className="alert alert--info stack-s" role="status">
          <span className="small">
            {t('Раньше вы создали ссылку-подписку на календарь. Она больше не нужна, её лучше отключить.')}
          </span>
          <div>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              disabled={removeState.isLoading}
              onClick={() => void removeLink()}
            >
              {t('Отключить старую ссылку')}
            </button>
          </div>
        </div>
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
