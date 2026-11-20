import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { errorCode, errorText, isDailyLimit } from '../../api/errors';
import type { ApiHistoryItem, CaseStage, HistoryGroup, LetterClaim, LetterDeadline } from '../../api/types';
import { Icon } from '../../components/Icon';
import { ErrorAlert, Loading, PageHeader, StageChip } from '../../components/ui';
import { daysUntil, deadlineText, formatDate, formatDateTime, todayBerlin } from '../../lib/dates';
import {
  useCaseDetailQuery,
  useDeleteCaseMutation,
  useExplanationQuery,
  useLazyHistoryPageQuery,
  useLetterQuery,
  useUpdateCaseMutation,
} from '../../store/api';
import { LetterOriginals } from '../../components/LetterOriginals';

/*
 * Экраны дела, письма с объяснением и истории (F03) на API B07 и B08.
 */

const STAGE_HINT: Partial<Record<CaseStage, string>> = {
  OVERDUE: 'Срок прошёл. Ответьте как можно скорее или обратитесь в консультацию.',
  DOCUMENTS: 'Ведомство ждёт от вас документы.',
  REPLY: 'Ведомство ждёт ваш ответ.',
  NEEDS_CHECK: 'Проверьте факты письма: черновик собирается только из подтверждённых.',
  WAITING: 'Вы ответили. Теперь ход за ведомством.',
};

const DEADLINE_KIND: Record<string, string> = {
  REPLY: 'ответить',
  DOCUMENTS: 'прислать документы',
  OBJECTION: 'возражение',
  FOLLOW_UP: 'напоминание',
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
    unconfirmed: <span className="status status--check">Не подтверждён: проверьте срок</span>,
    done: <span className="status status--done">Выполнен</span>,
    overdue: <span className="status status--overdue">Просрочен</span>,
    active: <span className="status status--action">Действует</span>,
  }[state];
  return (
    <div className="row-between" data-testid="deadline" data-state={state}>
      <span className="stack-s" style={{ gap: 2 }}>
        <span style={{ fontWeight: 700 }}>
          {state === 'unconfirmed' ? 'возможно, ' : ''}до {formatDate(d.date)}
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
        <PageHeader title={notFound ? 'Дело не найдено' : 'Не получилось открыть дело'} back="/app/cases" />
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
          {cs.authority ?? 'ведомство не подтверждено'} · {cs.caseNumber ?? 'номер дела не подтверждён'}
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
            <div className="card stack-s" aria-label="Сроки">
              <span className="eyebrow">Сроки</span>
              {cs.deadlines.map((d) => (
                <DeadlineRow key={d.id} d={d} />
              ))}
            </div>
          )}
          <div className="stack">
            <h2 style={{ fontSize: 19 }}>Письма</h2>
            {cs.letters.length === 0 && <p className="muted">В деле пока нет писем.</p>}
            {cs.letters.map((l) => (
              <div key={l.id} className="card stack-s" data-testid="case-letter">
                <div className="row-between">
                  <span style={{ fontWeight: 600 }}>
                    {l.authority ?? 'Письмо'} · {formatDate(l.createdAt.slice(0, 10))}
                  </span>
                  {l.unconfirmed > 0 && <span className="status status--check">Проверить фактов: {l.unconfirmed}</span>}
                </div>
                <div className="row wrap">
                  <Link to={`/app/letters/${l.id}`} className="btn btn--secondary btn--small">
                    Объяснение
                  </Link>
                  <Link to={`/app/letters/${l.id}/check`} className="btn btn--ghost btn--small">
                    Проверить факты
                  </Link>
                </div>
              </div>
            ))}
          </div>
          <div className="row wrap">
            <Link to={`/app/cases/${cs.id}/answer`} className="btn btn--primary">
              <Icon name="send" size={18} color="#FFFFFF" /> Подготовить ответ
            </Link>
            <Link to="/app/scan" className="btn btn--secondary">
              <Icon name="plus" size={18} /> Добавить письмо
            </Link>
          </div>
        </section>
        <section className="stack">
          <h2 style={{ fontSize: 19 }}>История дела</h2>
          <ol className="list-reset stack">
            {cs.timeline.map((t) => (
              <li key={t.id} className="card stack-s" style={{ padding: 14 }}>
                <span style={{ fontWeight: 600 }}>{t.title}</span>
                <span className="muted">
                  {formatDateTime(t.at)}
                  {t.subtitle ? ` · ${t.subtitle}` : ''}
                </span>
              </li>
            ))}
          </ol>
          <div className="row wrap">
            <button type="button" className="btn btn--secondary btn--small" disabled={updating.isLoading} onClick={() => void setStatus(closed ? 'OPEN' : 'CLOSED')}>
              {closed ? 'Открыть снова' : 'Завершить дело'}
            </button>
            {!askDelete && (
              <button type="button" className="btn btn--danger btn--small" onClick={() => setAskDelete(true)}>
                <Icon name="trash" size={16} /> Удалить дело
              </button>
            )}
          </div>
          {askDelete && (
            <div className="alert alert--error stack-s" role="alertdialog" aria-label="Удалить дело">
              <span>Удалятся письма дела, их факты, сроки и файлы. Восстановить нельзя.</span>
              <div className="row wrap">
                <button type="button" className="btn btn--danger btn--small" disabled={deleting.isLoading} onClick={() => void remove()}>
                  Удалить безвозвратно
                </button>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setAskDelete(false)}>
                  Отмена
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
      <summary className="small text-2">На чём основано</summary>
      <ul className="list-reset stack-s" style={{ marginTop: 6 }}>
        {found.map((c) => (
          <li key={c.id} className="small">
            {c.text}
            {c.quote ? <span className="text-2"> · «{c.quote}»</span> : <span className="text-2"> · указано вами, цитаты из письма нет</span>}
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
        <PageHeader title={notFound ? 'Письмо не найдено' : 'Не получилось открыть письмо'} back="/app/cases" />
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
      <PageHeader title="Письмо" subtitle="Объяснение по фактам письма. Перепроверьте сроки по оригиналу." back={back} />
      <LetterOriginals letterId={id} files={letter.data.letter.files} />
      <div className="desktop-2col stack">
        <section className="stack">
          {expl.isFetching && <Loading text="Ja!sno объясняет письмо…" />}

          {!expl.isFetching && code === 'CLAIMS_CHANGED' && (
            <div className="alert alert--info" role="status">
              Факты письма изменились. Обновляем объяснение…
            </div>
          )}
          {!expl.isFetching && code === 'DATES_NOT_VERIFIED' && (
            <div className="stack-s" data-testid="dates-not-verified">
              <div className="alert alert--warn" role="alert">
                Не удалось надёжно объяснить сроки. Посмотрите срок в оригинале письма.
              </div>
              <ul className="list-reset stack-s">
                {claims
                  .filter((c) => c.status === 'CONFIRMED')
                  .map((c) => (
                    <li key={c.id} className="card small">
                      {c.text}
                      {c.quote && <span className="text-2"> · «{c.quote}»</span>}
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {!expl.isFetching && code === 'NO_CLAIMS' && (
            <div className="alert alert--info" role="status">
              Нет фактов для объяснения. <Link to={`/app/letters/${id}/check`}>Проверьте факты письма</Link>.
            </div>
          )}
          {!expl.isFetching && expl.isError && !['CLAIMS_CHANGED', 'DATES_NOT_VERIFIED', 'NO_CLAIMS'].includes(code ?? '') && (
            <ErrorAlert error={expl.error} />
          )}

          {show && expl.data && (
            <>
              <div className="card stack-s" data-testid="explanation">
                <span className="eyebrow">О чём письмо</span>
                <p style={{ fontSize: 16 }}>{expl.data.about.text}</p>
                {expl.data.about.unconfirmed && <span className="small text-2">Часть фактов ещё не подтверждена.</span>}
                <Sources ids={expl.data.about.claimIds} claims={byId} />
              </div>
              {expl.data.actions.length > 0 && (
                <div className="card stack-s">
                  <span className="eyebrow">Что сделать</span>
                  <ol className="stack-s" style={{ margin: 0, paddingLeft: 18 }}>
                    {expl.data.actions.map((a, i) => (
                      <li key={i} className="stack-s" data-testid="action">
                        <span>{a.text}</span>
                        {a.unconfirmed && <span className="status status--check">Проверьте: факт ещё не подтверждён</span>}
                        <Sources ids={a.claimIds} claims={byId} />
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {expl.data.deadlines.length > 0 && (
                <div className="card stack-s" aria-label="Сроки письма">
                  <span className="eyebrow">Сроки</span>
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
              {code === 'LLM_QUOTA' || expl.isError ? 'Попробовать ещё раз' : 'Обновить объяснение'}
            </button>
            <Link to={`/app/letters/${id}/check`} className="btn btn--ghost btn--small">
              Проверить факты
            </Link>
          </div>
        </section>
        <section className="stack">
          <details className="card">
            <summary>Текст письма</summary>
            <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
              {letter.data.letter.text}
            </pre>
          </details>
        </section>
      </div>
    </>
  );
}

// ---------- История ----------

const GROUPS: { id: HistoryGroup | 'all'; label: string }[] = [
  { id: 'all', label: 'Всё' },
  { id: 'letter', label: 'Письма' },
  { id: 'question', label: 'Вопросы' },
  { id: 'draft', label: 'Черновики' },
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
      <PageHeader title="История" subtitle="Все события по вашим делам." />
      <div className="row wrap" role="group" aria-label="Фильтр истории">
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
        <label htmlFor="history-q">Поиск в загруженных событиях</label>
        <input id="history-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorAlert error={error} />
      <ol className="list-reset stack" aria-label="События">
        {shown.map((i) => (
          <li key={i.id}>
            {/* Правка 18-11: ссылка — вся карточка события, а не только название дела */}
            <Link
              to={`/app/cases/${i.caseId}`}
              className="card stack-s history-link"
              style={{ padding: 14 }}
              data-testid="history-item"
            >
              <span style={{ fontWeight: 600 }}>{i.title}</span>
              <span className="muted">
                {formatDateTime(i.at)} · <span className="history-case">{i.caseTitle}</span>
                {i.subtitle ? ` · ${i.subtitle}` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ol>
      {loading && <Loading />}
      {!loading && items.length === 0 && !error && <p className="muted">Событий пока нет.</p>}
      {!loading && cursor && (
        <button type="button" className="btn btn--secondary" onClick={() => void load(group, cursor)}>
          Показать ещё
        </button>
      )}
    </>
  );
}
