import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorCode, errorText, isDailyLimit } from '../../api/errors';
import type { ApiCaseDetail, ApiHistoryItem, CaseStage, HistoryGroup, LetterClaim, LetterDeadline } from '../../api/types';
import { Icon } from '../../components/Icon';
import { ErrorAlert, Loading, PageHeader, StageChip } from '../../components/ui';
import { daysUntil, deadlineText, formatDate, formatDateTime, todayBerlin } from '../../lib/dates';
import {
  useCaseDetailQuery,
  useDeleteCaseMutation,
  useDeleteLetterMutation,
  useExplanationQuery,
  useLazyHistoryPageQuery,
  useLetterQuery,
  useRenameLetterMutation,
  useTranslateLetterMutation,
  useUpdateCaseMutation,
  useSetDeadlineDoneMutation,
} from '../../store/api';
import { LetterOriginals } from '../../components/LetterOriginals';
import { deadlineEvent, GoogleEventButton } from '../../components/calendar';
import { getLang, t, tMsg } from '../../i18n';

/*
 * Экраны дела, письма с объяснением и истории (F03) на API B07 и B08.
 */

const STAGE_HINT: Partial<Record<CaseStage, string>> = {
  OVERDUE: t('Срок прошёл. Ответьте как можно скорее или обратитесь в консультацию.'),
  DOCUMENTS: t('Ведомство ждёт от вас документы.'),
  REPLY: t('Ведомство ждёт ваш ответ.'),
  NEEDS_CHECK: t('Проверьте факты письма: черновик собирается только из подтверждённых.'),
  WAITING: t('Вы ответили. Теперь ход за ведомством.'),
};

const DEADLINE_KIND: Record<string, string> = {
  REPLY: t('ответить'),
  DOCUMENTS: t('прислать документы'),
  OBJECTION: t('возражение'),
  FOLLOW_UP: t('напоминание'),
};

export type DeadlineState = 'unconfirmed' | 'done' | 'overdue' | 'active';

/** Состояние срока. Неподтверждённый срок — не обязательство. Дни по Europe/Berlin. */
export function deadlineState(d: { date: string; active: boolean; done: boolean }, today = todayBerlin()): DeadlineState {
  if (!d.active) return 'unconfirmed';
  if (d.done) return 'done';
  return daysUntil(d.date, today) < 0 ? 'overdue' : 'active';
}

function DeadlineRow({ d }: { d: { date: string; kind: string; active: boolean; done: boolean } }) {
  const state = deadlineState(d);
  const label = {
    unconfirmed: <span className="status status--check">{t('Не подтверждён: проверьте срок')}</span>,
    done: <span className="status status--done">{t('Выполнен')}</span>,
    overdue: <span className="status status--overdue">{t('Просрочен')}</span>,
    active: <span className="status status--action">{t('Действует')}</span>,
  }[state];
  return (
    <div className="row-between" data-testid="deadline" data-state={state}>
      <span className="stack-s" style={{ gap: 2 }}>
        <span style={{ fontWeight: 700 }}>
          {state === 'unconfirmed' ? t('возможно, ') : ''}{t('до')}{' '}{formatDate(d.date)}
        </span>
        <span className="small text-2">
          {DEADLINE_KIND[d.kind] ?? d.kind}
          {state === 'active' || state === 'overdue' ? ` · ${deadlineText(d.date)}` : ''}
        </span>
      </span>
      {label}
    </div>
  );
}

/**
 * B12: действия с подтверждённым сроком — отметить выполненным (или открыть снова) и добавить в Google Календарь.
 * Поправка 26.11: вместо файла .ics — ссылка на готовое событие в Google Календаре.
 */
function DeadlineActions({
  caseId,
  d,
  caseTitle,
  authority,
}: {
  caseId: string;
  d: { id: string; date: string; kind: string; done: boolean };
  caseTitle: string;
  authority: string | null;
}) {
  const [setDone, saving] = useSetDeadlineDoneMutation();
  const [error, setError] = useState<unknown>(null);

  async function toggle() {
    setError(null);
    try {
      await setDone({ id: d.id, caseId, done: !d.done }).unwrap();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="stack-s">
      <div className="row wrap">
        <button type="button" className="btn btn--ghost btn--small" disabled={saving.isLoading} onClick={() => void toggle()}>
          <Icon name="check" size={16} /> {d.done ? t('Открыть срок снова') : t('Выполнено')}
        </button>
        {!d.done && (
          <GoogleEventButton event={deadlineEvent({ date: d.date, kind: d.kind, authority, caseTitle, caseId })} />
        )}
      </div>
      <ErrorAlert error={error} />
    </div>
  );
}

/** Поправка 24.11: дата письма (факт LETTER_DATE), а не дата загрузки. */
export function letterDateText(d: { date: string; confirmed: boolean } | null | undefined): string {
  if (!d) return t('дата письма не найдена');
  return d.confirmed ? t('от {v0}', { v0: formatDate(d.date) }) : t('от {v0}, дата не подтверждена', { v0: formatDate(d.date) });
}

/** Письмо в карточке дела. Поправка 24.11: каждое письмо можно удалить (с подтверждением). */
function CaseLetterCard({ letter: l }: { letter: ApiCaseDetail['letters'][number] }) {
  const [deleteLetter, deleting] = useDeleteLetterMutation();
  const [askDelete, setAskDelete] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const name = l.title || l.authority || t('Письмо');

  async function remove() {
    setError(null);
    try {
      await deleteLetter(l.id).unwrap();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="card stack-s" data-testid="case-letter">
      <div className="row-between">
        <span className="stack-s" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{name}</span>
          {l.letterDate !== undefined && (
            <span className="small text-2" data-testid="letter-date">
              {letterDateText(l.letterDate)}
            </span>
          )}
        </span>
        {l.unconfirmed > 0 && <span className="status status--check">{t('Проверить фактов:')}{' '}{l.unconfirmed}</span>}
      </div>
      <div className="row wrap">
        <Link to={`/app/letters/${l.id}`} className="btn btn--secondary btn--small">
          {t('Объяснение')}
        </Link>
        <Link to={`/app/letters/${l.id}/check`} className="btn btn--ghost btn--small">
          {t('Проверить факты')}
        </Link>
        {!askDelete && (
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setAskDelete(true)}>
            <Icon name="trash" size={16} />{' '}{t('Удалить письмо')}
          </button>
        )}
      </div>
      {askDelete && (
        <div className="alert alert--error stack-s" role="alertdialog" aria-label={t('Удалить письмо «{v0}»', { v0: name })}>
          <span>{t('Удалятся письмо, его факты, сроки и файлы. Дело и другие письма останутся. Восстановить нельзя.')}</span>
          <div className="row wrap">
            <button type="button" className="btn btn--danger btn--small" disabled={deleting.isLoading} onClick={() => void remove()}>
              {t('Удалить письмо безвозвратно')}
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => setAskDelete(false)}>
              {t('Отмена')}
            </button>
          </div>
        </div>
      )}
      <ErrorAlert error={error} />
    </div>
  );
}

// ---------- Дело ----------

export function CasePage({ id }: { id: string }) {
  const c = useCaseDetailQuery(id);
  const [updateCase, updating] = useUpdateCaseMutation();
  const [deleteCase, deleting] = useDeleteCaseMutation();
  const [askDelete, setAskDelete] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const navigate = useNavigate();

  if (c.isLoading) return <Loading />;
  if (c.error || !c.data) {
    const notFound = errorCode(c.error) === 'NOT_FOUND';
    return (
      <>
        <PageHeader title={notFound ? t('Дело не найдено') : t('Не получилось открыть дело')} back="/app/cases" />
        {!notFound && <ErrorAlert error={c.error} />}
      </>
    );
  }
  const cs = c.data;
  const closed = cs.stage === 'CLOSED';

  async function setStatus(status: 'OPEN' | 'CLOSED') {
    setProblem(null);
    try {
      await updateCase({ id, status }).unwrap();
    } catch (err) {
      setProblem(errorText(err));
    }
  }

  async function remove() {
    setProblem(null);
    try {
      await deleteCase(id).unwrap();
      await navigate('/app/cases', { replace: true, flushSync: true });
    } catch (err) {
      setProblem(errorText(err));
    }
  }

  return (
    <>
      <PageHeader title={cs.title} back="/app/cases" />
      <div className="row wrap">
        <StageChip stage={cs.stage} />
        <span className="muted">
          {cs.authority ?? t('ведомство не подтверждено')} · {cs.caseNumber ?? t('номер дела не подтверждён')}
        </span>
      </div>
      {STAGE_HINT[cs.stage] && <div className="alert alert--info">{STAGE_HINT[cs.stage]}</div>}
      {problem && (
        <div className="alert alert--error" role="alert">
          {problem}
        </div>
      )}
      <div className="desktop-2col stack">
        <section className="stack">
          {cs.deadlines.length > 0 && (
            <div className="card stack-s" aria-label={t('Сроки')}>
              <span className="eyebrow">{t('Сроки')}</span>
              {cs.deadlines.map((d) => (
                <div key={d.id} className="stack-s deadline-item">
                  <DeadlineRow d={d} />
                  {d.active && <DeadlineActions caseId={id} d={d} caseTitle={cs.title} authority={cs.authority} />}
                </div>
              ))}
            </div>
          )}
          {cs.origin === 'OUTGOING' && (
            <div className="card card--teal stack-s" data-testid="own-letter">
              <span className="eyebrow">{t('Своё письмо')}</span>
              <span>{t('Это дело началось с вашего письма в ведомство. Ответ ведомства добавьте, когда он придёт.')}</span>
              {cs.drafts[0] && (
                <Link
                  to={`/app/cases/${cs.id}/answer/draft?draft=${cs.drafts[0].id}&kind=TEMPLATE`}
                  className="btn btn--primary btn--small"
                >
                  <Icon name="doc" size={16} color="#FFFFFF" />{' '}{t('Открыть письмо')}
                </Link>
              )}
            </div>
          )}
          <div className="stack">
            <h2 style={{ fontSize: 19 }}>{t('Письма')}</h2>
            {cs.letters.length === 0 && (
              <p className="muted">{cs.origin === 'OUTGOING' ? t('Писем от ведомства пока нет.') : t('В деле пока нет писем.')}</p>
            )}
            {cs.letters.map((l) => (
              <CaseLetterCard key={l.id} letter={l} />
            ))}
          </div>
          <div className="row wrap">
            {cs.letters.length > 0 && (
              <Link to={`/app/cases/${cs.id}/answer`} className="btn btn--primary">
                <Icon name="send" size={18} color="#FFFFFF" />{' '}{t('Подготовить ответ')}
              </Link>
            )}
            <Link to="/app/scan" className="btn btn--secondary">
              <Icon name="plus" size={18} />{' '}{t('Добавить письмо')}
            </Link>
          </div>
        </section>
        <section className="stack">
          <h2 style={{ fontSize: 19 }}>{t('История дела')}</h2>
          <ol className="list-reset stack">
            {cs.timeline.map((t) => (
              <li key={t.id} className="card stack-s" style={{ padding: 14 }}>
                <span style={{ fontWeight: 600 }}>{tMsg(t.title)}</span>
                <span className="muted">
                  {formatDateTime(t.at)}
                  {t.subtitle ? ` · ${tMsg(t.subtitle)}` : ''}
                </span>
              </li>
            ))}
          </ol>
          <div className="row wrap">
            <button type="button" className="btn btn--secondary btn--small" disabled={updating.isLoading} onClick={() => void setStatus(closed ? 'OPEN' : 'CLOSED')}>
              {closed ? t('Открыть снова') : t('Завершить дело')}
            </button>
            {!askDelete && (
              <button type="button" className="btn btn--danger btn--small" onClick={() => setAskDelete(true)}>
                <Icon name="trash" size={16} />{' '}{t('Удалить дело')}
              </button>
            )}
          </div>
          {askDelete && (
            <div className="alert alert--error stack-s" role="alertdialog" aria-label={t('Удалить дело')}>
              <span>{t('Удалятся письма дела, их факты, сроки и файлы. Восстановить нельзя.')}</span>
              <div className="row wrap">
                <button type="button" className="btn btn--danger btn--small" disabled={deleting.isLoading} onClick={() => void remove()}>
                  {t('Удалить безвозвратно')}
                </button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setAskDelete(false)}>
                  {t('Отмена')}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// ---------- Письмо с объяснением ----------

function Sources({ ids, claims }: { ids: string[]; claims: Map<string, LetterClaim> }) {
  const found = ids.map((id) => claims.get(id)).filter((c): c is LetterClaim => !!c);
  if (found.length === 0) return null;
  return (
    <details>
      <summary className="small text-2">{t('На чём основано')}</summary>
      <ul className="list-reset stack-s" style={{ marginTop: 6 }}>
        {found.map((c) => (
          <li key={c.id} className="small">
            {tMsg(c.text)}
            {c.quote ? <span className="text-2"> · «{c.quote}»</span> : <span className="text-2">{' '}{t('· указано вами, цитаты из письма нет')}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function LetterPage({ id }: { id: string }) {
  const letter = useLetterQuery(id);
  // Объяснение запрашивается при открытии экрана (сервер отдаёт кэш, если факты не менялись) или по кнопке.
  const expl = useExplanationQuery(id, { refetchOnMountOrArgChange: true });
  const code = errorCode(expl.error);
  const retried = useRef<unknown>(null);

  // Факты изменились во время ответа: сначала перечитать факты, потом запросить объяснение. Один раз на ошибку.
  useEffect(() => {
    if (code !== 'CLAIMS_CHANGED' || retried.current === expl.error) return;
    retried.current = expl.error;
    // Если запрос письма уже идёт, refetch не отправляет новый, а ждёт его. Этот ответ мог быть
    // собран до изменения фактов, поэтому после него письмо читается ещё раз.
    const inFlight = letter.isFetching;
    void (async () => {
      await letter.refetch();
      if (inFlight) await letter.refetch();
      await expl.refetch();
    })();
  }, [code, expl, letter]);

  if (letter.isLoading) return <Loading />;
  if (letter.error || !letter.data) {
    const notFound = errorCode(letter.error) === 'NOT_FOUND';
    return (
      <>
        <PageHeader title={notFound ? t('Письмо не найдено') : t('Не получилось открыть письмо')} back="/app/cases" />
        {!notFound && <ErrorAlert error={letter.error} />}
      </>
    );
  }

  const { claims, deadlines } = letter.data;
  const byId = new Map(claims.map((c) => [c.id, c]));
  const deadlineByClaim = new Map<string, LetterDeadline>(deadlines.map((d) => [d.claimId, d]));
  const back = letter.data.letter.caseId ? `/app/cases/${letter.data.letter.caseId}` : '/app';
  const show = !expl.isFetching && !expl.isError && expl.data;

  return (
    <>
      <PageHeader
        title={letter.data.letter.title || t('Письмо')}
        subtitle={t('Объяснение по фактам письма. Перепроверьте сроки по оригиналу.')}
        back={back}
      />
      <LetterTitleEditor letterId={id} title={letter.data.letter.title ?? null} />
      <LetterOriginals letterId={id} files={letter.data.letter.files} />
      <div className="desktop-2col stack">
        <section className="stack">
          {expl.isFetching && <Loading text={t('Ja!sno объясняет письмо…')} />}

          {!expl.isFetching && code === 'CLAIMS_CHANGED' && (
            <div className="alert alert--info" role="status">
              {t('Факты письма изменились. Обновляем объяснение…')}
            </div>
          )}
          {!expl.isFetching && code === 'DATES_NOT_VERIFIED' && (
            <div className="stack-s" data-testid="dates-not-verified">
              <div className="alert alert--warn" role="alert">
                {t('Не удалось надёжно объяснить сроки. Посмотрите срок в оригинале письма.')}
              </div>
              <ul className="list-reset stack-s">
                {claims
                  .filter((c) => c.status === 'CONFIRMED')
                  .map((c) => (
                    <li key={c.id} className="card small">
                      {tMsg(c.text)}
                      {c.quote && <span className="text-2"> · «{c.quote}»</span>}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {!expl.isFetching && code === 'NO_CLAIMS' && (
            <div className="alert alert--info" role="status">
              {t('Нет фактов для объяснения.')}{' '}<Link to={`/app/letters/${id}/check`}>{t('Проверьте факты письма')}</Link>.
            </div>
          )}
          {!expl.isFetching && expl.isError && !['CLAIMS_CHANGED', 'DATES_NOT_VERIFIED', 'NO_CLAIMS'].includes(code ?? '') && (
            <ErrorAlert error={expl.error} />
          )}

          {show && expl.data && (
            <>
              <div className="card stack-s" data-testid="explanation">
                <span className="eyebrow">{t('О чём письмо')}</span>
                <p style={{ fontSize: 16 }}>{expl.data.about.text}</p>
                {expl.data.about.unconfirmed && <span className="small text-2">{t('Часть фактов ещё не подтверждена.')}</span>}
                <Sources ids={expl.data.about.claimIds} claims={byId} />
              </div>
              {(expl.data.requests ?? []).length > 0 && (
                <div className="card stack-s" data-testid="requests">
                  <span className="eyebrow">{t('Ведомство просит')}</span>
                  <ul className="list-reset stack-s">
                    {expl.data.requests.map((q) => (
                      <li key={q.claimId} className="stack-s" data-testid="request">
                        {q.ru && <span lang={getLang()}>{q.ru}</span>}
                        <span lang="de" className={q.ru ? 'small text-2' : undefined}>
                          {q.ru && <span aria-hidden="true">DE · </span>}
                          {q.de}
                        </span>
                        {q.unconfirmed && <span className="status status--check">{t('Проверьте: факт ещё не подтверждён')}</span>}
                      </li>
                    ))}
                  </ul>
                  <span className="small text-2">{t('Немецкий текст — как в письме. Его можно показать в ведомстве или найти документ по этому названию.')}</span>
                </div>
              )}
              {expl.data.actions.length > 0 && (
                <div className="card stack-s">
                  <span className="eyebrow">{t('Что сделать')}</span>
                  <ol className="stack-s" style={{ margin: 0, paddingLeft: 18 }}>
                    {expl.data.actions.map((a, i) => (
                      <li key={i} className="stack-s" data-testid="action">
                        <span>{a.text}</span>
                        {a.unconfirmed && <span className="status status--check">{t('Проверьте: факт ещё не подтверждён')}</span>}
                        <Sources ids={a.claimIds} claims={byId} />
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {expl.data.deadlines.length > 0 && (
                <div className="card stack-s" aria-label={t('Сроки письма')}>
                  <span className="eyebrow">{t('Сроки')}</span>
                  {expl.data.deadlines.map((d) => {
                    const own = deadlineByClaim.get(d.claimId);
                    return (
                      <DeadlineRow
                        key={d.claimId}
                        d={{ date: d.date, kind: d.kind, active: own?.active ?? d.confirmed, done: own?.done ?? false }}
                      />
                    );
                  })}
                </div>
              )}
            </>
          )}

          <div className="row wrap">
            <button
              type="button"
              className="btn btn--secondary btn--small"
              // B18: при дневном лимите повтор сразу бесполезен, время ожидания — в тексте ошибки
              disabled={expl.isFetching || isDailyLimit(expl.error)}
              onClick={() => void expl.refetch()}
            >
              {code === 'LLM_QUOTA' || expl.isError ? t('Попробовать ещё раз') : t('Обновить объяснение')}
            </button>
            <Link to={`/app/letters/${id}/check`} className="btn btn--ghost btn--small">
              {t('Проверить факты')}
            </Link>
          </div>
        </section>
        <section className="stack">
          <details className="card">
            <summary>{t('Текст письма')}</summary>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
              {letter.data.letter.text}
            </pre>
          </details>
          <LetterTranslation letterId={id} text={letter.data.letter.text} />
        </section>
      </div>
    </>
  );
}

/** Поправка 8 (23.11): название письма предлагает модель по цитате, человек может изменить. */
function LetterTitleEditor({ letterId, title }: { letterId: string; title: string | null }) {
  const [rename, renaming] = useRenameLetterMutation();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  if (!editing) {
    return (
      <div className="row wrap" style={{ gap: 8 }}>
        {title && <span className="small text-2">{t('Название предложил Ja!sno по строке письма. Его можно изменить.')}</span>}
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => {
            setValue(title ?? '');
            setProblem(null);
            setEditing(true);
          }}
        >
          <Icon name="pen" size={16} /> {title ? t('Изменить название') : t('Дать название')}
        </button>
      </div>
    );
  }
  const save = async () => {
    const next = value.trim();
    if (!next) {
      setProblem(t('Введите название'));
      return;
    }
    const r = await rename({ id: letterId, title: next });
    if ('error' in r) setProblem(errorText(r.error));
    else setEditing(false);
  };
  return (
    <form
      className="card stack-s"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="field">
        <label htmlFor="letter-title">{t('Название письма')}</label>
        <input
          id="letter-title"
          className="input"
          value={value}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={problem ? true : undefined}
        />
        {problem && <span className="field-error">{problem}</span>}
      </div>
      <div className="row wrap">
        <button type="submit" className="btn btn--primary btn--small" disabled={renaming.isLoading}>
          {t('Сохранить')}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing(false)}>
          {t('Отмена')}
        </button>
      </div>
    </form>
  );
}

/** Поправка 7 (23.11): машинный перевод всего письма на русский, только по кнопке. */
function LetterTranslation({ letterId, text }: { letterId: string; text: string }) {
  const [translate, state] = useTranslateLetterMutation();
  return (
    <div className="card stack-s" data-testid="translation">
      <span className="eyebrow">{t('Перевод на русский')}</span>
      {!state.data && (
        <>
          <p className="small text-2">
            {t('Весь текст письма по-русски. Это машинный перевод, он не официальный: для ведомства важен немецкий оригинал.')}
          </p>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            style={{ alignSelf: 'flex-start' }}
            disabled={state.isLoading || isDailyLimit(state.error)}
            onClick={() => void translate({ id: letterId, text })}
          >
            {state.isLoading ? t('Переводим…') : state.isError ? t('Попробовать ещё раз') : t('Перевести письмо')}
          </button>
        </>
      )}
      {state.isLoading && <Loading text={t('Ja!sno переводит письмо…')} />}
      {state.isError && <ErrorAlert error={state.error} />}
      {state.data && (
        <>
          <span className="status status--check" data-testid="translation-note">
            {t('Машинный перевод, не официальный')}
          </span>
          <pre lang="ru" className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {state.data.text}
          </pre>
        </>
      )}
    </div>
  );
}

// ---------- История ----------

const GROUPS: { id: HistoryGroup | 'all'; label: string }[] = [
  { id: 'all', label: t('Всё') },
  { id: 'letter', label: t('Письма') },
  { id: 'case', label: t('Дела') },
  { id: 'question', label: t('Вопросы') },
  { id: 'draft', label: t('Черновики') },
];

/** История всех дел: страницы по 30. Смена фильтра сбрасывает курсор и накопленные записи. */
export function HistoryPage() {
  const [group, setGroup] = useState<HistoryGroup | 'all'>('all');
  const [items, setItems] = useState<ApiHistoryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [fetchPage] = useLazyHistoryPageQuery();
  const request = useRef(0);

  async function load(g: HistoryGroup | 'all', after: string | null) {
    const mine = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage({ ...(g === 'all' ? {} : { type: g }), ...(after ? { cursor: after } : {}) }).unwrap();
      if (mine !== request.current) return; // ответ для старого фильтра
      setItems((old) => {
        const seen = new Set(old.map((i) => i.id));
        return [...old, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setCursor(page.nextCursor);
    } catch (err) {
      if (mine === request.current) setError(err);
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }

  useEffect(() => {
    setItems([]);
    setCursor(null);
    void load(group, null);
  }, [group]);

  const shown = items.filter((i) => !q || `${i.title} ${i.subtitle ?? ''} ${i.caseTitle}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title={t('История')} subtitle={t('Все события по вашим делам и вопросы в чате с Ja!sno.')} />
      <div className="row wrap" role="group" aria-label={t('Фильтр истории')}>
        {GROUPS.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`btn btn--small ${group === g.id ? 'btn--navy' : 'btn--secondary'}`}
            aria-pressed={group === g.id}
            onClick={() => setGroup(g.id)}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="history-q">{t('Поиск в загруженных событиях')}</label>
        <input id="history-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorAlert error={error} />
      <ol className="list-reset stack" aria-label={t('События')}>
        {shown.map((i) => (
          <li key={i.id}>
            {/* Правка 18-11: ссылка — вся карточка события, а не только название дела */}
            <Link
              to={i.caseId ? `/app/cases/${i.caseId}` : '/app/ask'}
              className="card stack-s history-link"
              style={{ padding: 14 }}
              data-testid="history-item"
            >
              <span style={{ fontWeight: 600 }}>{tMsg(i.title)}</span>
              <span className="muted">
                {formatDateTime(i.at)} · <span className="history-case">{tMsg(i.caseTitle)}</span>
                {i.subtitle ? ` · ${tMsg(i.subtitle)}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {loading && <Loading />}
      {!loading && items.length === 0 && !error && <p className="muted">{t('Событий пока нет.')}</p>}
      {!loading && cursor && (
        <button type="button" className="btn btn--secondary" onClick={() => void load(group, cursor)}>
          {t('Показать ещё')}
        </button>
      )}
    </>
  );
}
