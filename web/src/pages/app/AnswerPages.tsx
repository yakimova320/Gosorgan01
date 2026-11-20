import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { errorCode, errorText, isApiError } from '../../api/errors';
import type { ApiDraft, CreateDraftArgs, DraftKind, ExtensionReason, QuestionId, SentVia } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { ErrorAlert, Loading, PageHeader } from '../../components/ui';
import { formatDate, todayBerlin } from '../../lib/dates';
import { DRAFT_KIND } from '../../lib/labels';
import {
  useCaseDetailQuery,
  useCreateDraftMutation,
  useDraftQuery,
  useDraftQuestionsQuery,
  useEditDraftMutation,
  useReportSentMutation,
} from '../../store/api';

/*
 * Ответ ведомству (F04, B12): вид ответа → детали → черновик (копировать, править с проверкой) → «Я отправил(а)».
 * Выбор живёт в URL (letter, kind, q, amount, reason, deadline, draft), поэтому переживает обновление страницы.
 * Черновик собирает сервер по шаблону из подтверждённых фактов; Ja!sno сам ничего не отправляет.
 */

const KINDS: DraftKind[] = ['CLARIFICATION', 'DOCUMENTS', 'EXTENSION', 'STATUS_REQUEST'];

/** Параметры шага в URL. */
function useAnswerParams() {
  const [search] = useSearchParams();
  const kind = search.get('kind') as DraftKind | null;
  return {
    letterId: search.get('letter'),
    kind: kind && KINDS.includes(kind) ? kind : null,
    questionId: search.get('q') as QuestionId | null,
    amountClaimId: search.get('amount'),
    reason: search.get('reason') as ExtensionReason | null,
    deadlineClaimId: search.get('deadline'),
    draftId: search.get('draft'),
  };
}

const qs = (p: Record<string, string | null | undefined>) =>
  new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();

/** Параметры сборки из черновика: для «Собрать заново» тем же видом и с теми же ответами. */
function rebuildArgs(draft: ApiDraft, amountClaimId: string | null): CreateDraftArgs | null {
  if (!draft.letterId) return null;
  const base = { caseId: draft.caseId, letterId: draft.letterId };
  switch (draft.kind) {
    case 'CLARIFICATION':
      return draft.questionId
        ? { ...base, kind: 'CLARIFICATION', questionId: draft.questionId, ...(draft.questionId === 'AMOUNT' && amountClaimId ? { amountClaimId } : {}) }
        : null;
    case 'EXTENSION':
      return { ...base, kind: 'EXTENSION', reason: draft.reason ?? 'NONE', ...(draft.deadlineClaimId ? { deadlineClaimId: draft.deadlineClaimId } : {}) };
    default:
      return { ...base, kind: draft.kind };
  }
}

/** Адрес черновика с параметрами сборки. */
function draftUrl(caseId: string, draft: ApiDraft, amountClaimId?: string | null) {
  return `/app/cases/${caseId}/answer/draft?${qs({
    draft: draft.id,
    letter: draft.letterId,
    kind: draft.kind,
    q: draft.questionId,
    amount: draft.questionId === 'AMOUNT' ? amountClaimId : null,
  })}`;
}

/** Шаг 1: вид ответа и письмо, на которое отвечаем. Доступные виды считает сервер по подтверждённым фактам. */
export function AnswerGoalPage({ caseId }: { caseId: string }) {
  const c = useCaseDetailQuery(caseId);
  const { letterId } = useAnswerParams();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<string | null>(letterId);
  const letters = c.data?.letters ?? [];
  const letter = chosen ?? (letters.length === 1 ? letters[0].id : null);
  const q = useDraftQuestionsQuery(letter ?? '', { skip: !letter, refetchOnMountOrArgChange: true });

  if (c.isLoading) return <Loading />;
  if (c.error || !c.data) return <ErrorAlert error={c.error} />;
  const available = new Set(q.data?.caseId === caseId ? q.data.kinds : []);

  return (
    <>
      <PageHeader title="Чего вы хотите?" subtitle="Ja!sno соберёт черновик только из подтверждённых фактов." back={`/app/cases/${caseId}`} />
      {letters.length > 1 && (
        <fieldset className="stack-s" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small text-2">На какое письмо ответить</legend>
          {letters.map((l) => (
            <label key={l.id} className="checkbox">
              <input type="radio" name="letter" checked={letter === l.id} onChange={() => setChosen(l.id)} />
              <span>
                {l.authority ?? 'Письмо'} · {formatDate(l.createdAt.slice(0, 10))}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {letter && q.isFetching && <Loading text="Проверяем, какие ответы доступны…" />}
      <ul className="list-reset stack">
        {KINDS.map((k) => {
          const d = DRAFT_KIND[k];
          const ok = !!letter && !q.isFetching && available.has(k);
          return (
            <li key={k}>
              <button
                type="button"
                className="card row"
                data-testid={`kind-${k}`}
                disabled={!ok}
                style={{ width: '100%', textAlign: 'left', border: 0, cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : 0.6 }}
                onClick={() => navigate(`/app/cases/${caseId}/answer/details?${qs({ letter, kind: k })}`)}
              >
                <Icon name="send" color="var(--c-teal)" />
                <span className="stack-s" style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{d.title}</span>
                  <span className="muted">{ok || !letter || q.isFetching ? d.text : `${d.text}. ${d.unavailable}`}</span>
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <Link to="/beratung" className="card row">
            <Icon name="info" color="var(--c-orange)" />
            <span className="stack-s" style={{ flex: 1 }}>
              <span style={{ fontWeight: 600 }}>Возражение (Widerspruch)</span>
              <span className="muted">Ja!sno его не пишет. Где получить консультацию</span>
            </span>
          </Link>
        </li>
      </ul>
      {q.error ? <ErrorAlert error={q.error} /> : null}
      {letters.length === 0 && <div className="alert alert--info">В деле нет писем: добавьте письмо, чтобы ответить на него.</div>}
    </>
  );
}

/** Ошибки сборки черновика: текст и, где нужно, ссылка. Повтор — только по кнопке. */
function DraftError({ error, caseId, letterId }: { error: unknown; caseId: string; letterId: string }) {
  const code = errorCode(error);
  const link =
    code === 'NO_CONFIRMED_CLAIMS'
      ? { to: `/app/letters/${letterId}/check`, text: 'Проверить факты' }
      : code === 'PROFILE_INCOMPLETE'
        ? { to: '/app/profile', text: 'Открыть профиль' }
        : code === 'NOT_FOUND'
          ? { to: `/app/cases/${caseId}`, text: 'К делу' }
          : null;
  const failed =
    code === 'DRAFT_VERIFICATION_FAILED' && isApiError(error)
      ? ((error.details as { checks?: { name: string; passed: boolean; details: string | null }[] })?.checks ?? []).filter((c) => !c.passed)
      : [];
  return (
    <div className="alert alert--error stack-s" role="alert" data-testid="draft-error">
      <span>{code === 'DRAFT_SOURCES_CHANGED' ? 'Данные изменились, пока собирался черновик. Соберите заново.' : errorText(error)}</span>
      {failed.map((c) => (
        <span key={c.name} className="small">
          {c.name}: {c.details}
        </span>
      ))}
      {link && (
        <Link to={link.to} className="link">
          {link.text}
        </Link>
      )}
    </div>
  );
}

const DETAILS_TITLE: Record<DraftKind, { title: string; subtitle: string }> = {
  CLARIFICATION: { title: 'Что именно непонятно?', subtitle: 'Выберите вопрос. Он войдёт в письмо на немецком.' },
  DOCUMENTS: { title: 'Сопроводительное письмо', subtitle: 'Письмо к документам, которые просит ведомство.' },
  EXTENSION: { title: 'Попросить продлить срок', subtitle: 'Ja!sno попросит продлить срок на две недели.' },
  STATUS_REQUEST: { title: 'Узнать, как дела', subtitle: 'Письмо с вопросом, на каком этапе рассмотрение.' },
};

/** Шаг 2: детали вида ответа. Доступные варианты проверяет сервер. */
export function AnswerDetailsPage({ caseId }: { caseId: string }) {
  const params = useAnswerParams();
  const { letterId } = params;
  const kind = params.kind ?? 'CLARIFICATION';
  const q = useDraftQuestionsQuery(letterId ?? '', { skip: !letterId, refetchOnMountOrArgChange: true });
  const [createDraft, creating] = useCreateDraftMutation();
  const navigate = useNavigate();
  const [question, setQuestion] = useState<QuestionId | null>(params.questionId);
  const [amount, setAmount] = useState<string | null>(params.amountClaimId);
  const [reason, setReason] = useState<ExtensionReason | null>(params.reason);
  const [deadline, setDeadline] = useState<string | null>(params.deadlineClaimId);
  const [error, setError] = useState<unknown>(null);

  if (!letterId) return <Navigate to={`/app/cases/${caseId}/answer`} replace />;
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data || q.data.caseId !== caseId) {
    return (
      <>
        <PageHeader title="Письмо не найдено в этом деле" back={`/app/cases/${caseId}`} />
        {errorCode(q.error) !== 'NOT_FOUND' && q.error ? <ErrorAlert error={q.error} /> : null}
      </>
    );
  }
  const data = q.data;
  const kindAvailable = data.kinds.includes(kind);
  const available = data.questions;
  const selected = question && available.some((x) => x.id === question) ? question : null;
  const needsAmount = kind === 'CLARIFICATION' && selected === 'AMOUNT' && data.amounts.length > 1;
  const needsDeadline = kind === 'EXTENSION' && data.deadlines.length > 1;
  const chosenDeadline = deadline && data.deadlines.some((d) => d.claimId === deadline) ? deadline : null;
  const ready =
    kindAvailable &&
    (kind === 'CLARIFICATION'
      ? !!selected && (!needsAmount || !!amount)
      : kind === 'EXTENSION'
        ? !!reason && (!needsDeadline || !!chosenDeadline)
        : true);

  function args(): CreateDraftArgs | null {
    if (!letterId) return null;
    const base = { caseId, letterId };
    if (kind === 'CLARIFICATION')
      return selected ? { ...base, kind, questionId: selected, ...(selected === 'AMOUNT' && amount ? { amountClaimId: amount } : {}) } : null;
    if (kind === 'EXTENSION') return reason ? { ...base, kind, reason, ...(chosenDeadline ? { deadlineClaimId: chosenDeadline } : {}) } : null;
    return { ...base, kind };
  }

  async function submit() {
    const a = args();
    if (!a) return;
    setError(null);
    try {
      const draft = await createDraft(a).unwrap();
      navigate(draftUrl(caseId, draft, amount));
    } catch (err) {
      setError(err);
      void q.refetch(); // после ошибки — заново доступные варианты
    }
  }

  const t = DETAILS_TITLE[kind];
  return (
    <>
      <PageHeader title={t.title} subtitle={t.subtitle} back={`/app/cases/${caseId}/answer?${qs({ letter: letterId })}`} />
      {!kindAvailable && (
        <div className="alert alert--info">
          {DRAFT_KIND[kind].unavailable}. <Link to={`/app/letters/${letterId}/check`}>Проверьте факты письма</Link>.
        </div>
      )}
      {kind === 'CLARIFICATION' && kindAvailable && (
        <fieldset className="stack-s" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="visually-hidden">Вопрос</legend>
          {available.map((x) => (
            <label key={x.id} className="card checkbox" data-testid="question">
              <input type="radio" name="question" checked={selected === x.id} onChange={() => setQuestion(x.id)} />
              <span>{x.ru}</span>
            </label>
          ))}
        </fieldset>
      )}
      {needsAmount && (
        <fieldset className="stack-s" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small text-2">О какой сумме спросить</legend>
          {data.amounts.map((a) => (
            <label key={a.claimId} className="checkbox">
              <input type="radio" name="amount" checked={amount === a.claimId} onChange={() => setAmount(a.claimId)} />
              <span>{Number(a.value).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €</span>
            </label>
          ))}
        </fieldset>
      )}
      {kind === 'DOCUMENTS' && kindAvailable && (
        <div className="alert alert--info">
          Ja!sno напишет сопроводительное письмо со ссылкой на требование ведомства. Сами документы приложите к письму вы: Ja!sno их не
          прикладывает и не проверяет.
        </div>
      )}
      {kind === 'EXTENSION' && kindAvailable && (
        <>
          {data.deadlines.length === 1 && <p className="text-2">Срок в письме: до {formatDate(data.deadlines[0].date)}.</p>}
          {needsDeadline && (
            <fieldset className="stack-s" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small text-2">Какой срок продлить</legend>
              {data.deadlines.map((d) => (
                <label key={d.claimId} className="checkbox">
                  <input type="radio" name="deadline" checked={chosenDeadline === d.claimId} onChange={() => setDeadline(d.claimId)} />
                  <span>до {formatDate(d.date)}</span>
                </label>
              ))}
            </fieldset>
          )}
          <fieldset className="stack-s" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small text-2">Причина (войдёт в письмо)</legend>
            {data.extensionReasons.map((r) => (
              <label key={r.id} className="card checkbox" data-testid="reason">
                <input type="radio" name="reason" checked={reason === r.id} onChange={() => setReason(r.id)} />
                <span>{r.ru}</span>
              </label>
            ))}
          </fieldset>
          <p className="muted">Продление — просьба. Пока ведомство не ответило, действует прежний срок.</p>
        </>
      )}
      {kind === 'STATUS_REQUEST' && kindAvailable && (
        <div className="alert alert--info">Подходит, если вы уже ответили или отправили документы, а ведомство долго молчит.</div>
      )}
      {error ? <DraftError error={error} caseId={caseId} letterId={letterId} /> : null}
      <button type="button" className="btn btn--primary" disabled={!ready || creating.isLoading} onClick={() => void submit()}>
        {creating.isLoading ? 'Собираем черновик…' : 'Собрать черновик'}
      </button>
    </>
  );
}

type CopyState = { kind: 'idle' } | { kind: 'copied' } | { kind: 'manual' } | { kind: 'blocked'; text: string };

/** Шаг 3: черновик. Основания — снимок на момент сборки. Перед копированием — свежее состояние с сервера. */
export function AnswerDraftPage({ caseId }: { caseId: string }) {
  const { draftId, amountClaimId } = useAnswerParams();
  const d = useDraftQuery(draftId ?? '', { skip: !draftId, refetchOnMountOrArgChange: true });
  const [createDraft, rebuilding] = useCreateDraftMutation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'de' | 'ru'>('de');
  const [copy, setCopy] = useState<CopyState>({ kind: 'idle' });
  const [rebuildError, setRebuildError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState(false);

  if (!draftId) return <Navigate to={`/app/cases/${caseId}/answer`} replace />;
  if (d.isLoading) return <Loading text="Загружаем черновик…" />;
  // Ошибка повторного чтения при уже открытом черновике не прячет текст: копирование просто закрыто.
  if (!d.data || d.data.caseId !== caseId) {
    return (
      <>
        <PageHeader title="Черновик не найден" back={`/app/cases/${caseId}`} />
        {errorCode(d.error) !== 'NOT_FOUND' && d.error ? <ErrorAlert error={d.error} /> : null}
      </>
    );
  }
  const draft: ApiDraft = d.data;

  async function copyGerman() {
    setCopy({ kind: 'idle' });
    setChecking(true);
    try {
      // Ошибка проверки актуальности — не разрешение копировать.
      const fresh = await d.refetch().unwrap();
      if (fresh.stale) return setCopy({ kind: 'blocked', text: 'Данные изменились после сборки. Соберите черновик заново.' });
      try {
        await navigator.clipboard.writeText(fresh.germanText);
        setCopy({ kind: 'copied' });
      } catch {
        setCopy({ kind: 'manual' });
      }
    } catch (err) {
      setCopy({ kind: 'blocked', text: `Не удалось проверить, что черновик актуален: ${errorText(err)} Копирование недоступно.` });
    } finally {
      setChecking(false);
    }
  }

  async function rebuild() {
    const a = rebuildArgs(draft, amountClaimId);
    if (!a) return;
    setRebuildError(null);
    try {
      const fresh = await createDraft(a).unwrap();
      setCopy({ kind: 'idle' });
      setEditing(false);
      navigate(draftUrl(caseId, fresh, amountClaimId), { replace: true });
    } catch (err) {
      setRebuildError(err);
    }
  }

  const stale = draft.stale || copy.kind === 'blocked';
  const sent = draft.status === 'SENT';

  return (
    <>
      <PageHeader title={`Черновик: ${DRAFT_KIND[draft.kind]?.title.toLowerCase() ?? 'ответ'}`} subtitle="Проверьте текст, скопируйте и отправьте сами." back={`/app/cases/${caseId}`} />
      {sent && (
        <div className="alert alert--info" role="status" data-testid="draft-sent">
          Вы отметили: отправлено{draft.sentAt ? ` ${formatDate(draft.sentAt)}` : ''}. Править этот черновик больше нельзя.
        </div>
      )}
      {draft.edited && !sent && (
        <div className="alert alert--info" role="status">
          Текст изменён вами и проверен заново: даты, числа и номер дела совпадают с подтверждёнными фактами.
        </div>
      )}
      {stale && (
        <div className="alert alert--warn stack-s" role="alert" data-testid="draft-stale">
          <span>{copy.kind === 'blocked' ? copy.text : 'Данные изменились после сборки. Соберите черновик заново.'}</span>
          <button type="button" className="btn btn--primary btn--small" disabled={rebuilding.isLoading} onClick={() => void rebuild()}>
            Собрать заново
          </button>
        </div>
      )}
      {rebuildError ? <DraftError error={rebuildError} caseId={caseId} letterId={draft.letterId ?? ''} /> : null}

      {editing ? (
        <DraftEditor
          draft={draft}
          onDone={() => setEditing(false)}
        />
      ) : (
      <>
      <div className="row wrap draft-tabs" role="tablist" aria-label="Язык черновика">
        <button type="button" role="tab" aria-selected={tab === 'de'} className={`btn btn--small ${tab === 'de' ? 'btn--navy' : 'btn--secondary'}`} onClick={() => setTab('de')}>
          Немецкий
        </button>
        <button type="button" role="tab" aria-selected={tab === 'ru'} className={`btn btn--small ${tab === 'ru' ? 'btn--navy' : 'btn--secondary'}`} onClick={() => setTab('ru')}>
          Перевод
        </button>
      </div>
      <div className="desktop-2col stack draft-panels" data-tab={tab}>
        <section className="card stack-s draft-panel draft-panel--de" aria-label="Текст на немецком">
          <span className="eyebrow">Auf Deutsch</span>
          <pre data-testid="german-text" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>
            {draft.germanText}
          </pre>
        </section>
        <section className="card stack-s draft-panel draft-panel--ru" aria-label="Перевод на русский">
          <span className="eyebrow">Перевод</span>
          <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}>{draft.russianText}</pre>
        </section>
      </div>
      </>
      )}

      <details className="card" data-testid="draft-sources">
        <summary>Основания (на момент сборки)</summary>
        <ul className="list-reset stack-s" style={{ marginTop: 8 }}>
          {draft.verification.checklist.map((c) => (
            <li key={c.claimId} className="small">
              {c.text}
              {c.quote && <span className="text-2"> · «{c.quote}»</span>}
            </li>
          ))}
        </ul>
        <p className="small text-2">{draft.verification.note ?? 'Проверка: соответствует шаблону и фактам. Это не юридическая проверка.'}</p>
      </details>

      <button type="button" className="btn btn--primary" disabled={stale || checking} onClick={() => void copyGerman()}>
        <Icon name="copy" size={18} color="#FFFFFF" /> {checking ? 'Проверяем…' : 'Скопировать немецкий текст'}
      </button>
      {copy.kind === 'copied' && (
        <div className="alert alert--info" role="status">
          Скопировано. Вставьте текст в письмо или онлайн-кабинет, проверьте и отправьте сами. Ja!sno ничего не отправляет.
        </div>
      )}
      {!editing && !sent && (
        <div className="row wrap">
          <button type="button" className="btn btn--secondary btn--small" disabled={stale} onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} /> Изменить текст
          </button>
          <Link className="btn btn--secondary btn--small" to={`/app/cases/${caseId}/answer/send?${qs({ draft: draft.id })}`}>
            <Icon name="check" size={16} /> Я отправил(а)
          </Link>
        </div>
      )}
      {copy.kind === 'manual' && (
        <div className="stack-s" data-testid="manual-copy">
          <div className="alert alert--info" role="status">
            Браузер не дал скопировать автоматически. Выделите текст ниже и скопируйте вручную.
          </div>
          <textarea className="textarea" readOnly value={draft.germanText} onFocus={(e) => e.currentTarget.select()} aria-label="Текст для ручного копирования" />
        </div>
      )}
    </>
  );
}

/**
 * Правка черновика (B12, ТЗ v4 11.3). Сохраняется только после повторной проверки обоих текстов на сервере:
 * изменённый текст без проверки не получает зелёный отчёт. Ошибки проверки показываются списком.
 */
function DraftEditor({ draft, onDone }: { draft: ApiDraft; onDone: () => void }) {
  const [editDraft, saving] = useEditDraftMutation();
  const [germanText, setGerman] = useState(draft.germanText);
  const [russianText, setRussian] = useState(draft.russianText);
  const [error, setError] = useState<unknown>(null);
  const changed = germanText !== draft.germanText || russianText !== draft.russianText;

  async function save() {
    setError(null);
    try {
      await editDraft({ id: draft.id, germanText, russianText }).unwrap();
      onDone();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="stack" data-testid="draft-editor">
      <div className="alert alert--info">
        Можно поправить формулировки. Даты, суммы и номер дела должны совпадать с подтверждёнными фактами: Ja!sno проверит оба текста
        заново перед сохранением.
      </div>
      <div className="desktop-2col stack">
        <div className="field">
          <label htmlFor="edit-de">Текст на немецком</label>
          <textarea id="edit-de" className="textarea draft-textarea" value={germanText} onChange={(e) => setGerman(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="edit-ru">Перевод</label>
          <textarea id="edit-ru" className="textarea draft-textarea" value={russianText} onChange={(e) => setRussian(e.target.value)} />
        </div>
      </div>
      {error ? <DraftError error={error} caseId={draft.caseId} letterId={draft.letterId ?? ''} /> : null}
      <div className="row wrap">
        <button type="button" className="btn btn--primary btn--small" disabled={!changed || saving.isLoading} onClick={() => void save()}>
          {saving.isLoading ? 'Проверяем…' : 'Проверить и сохранить'}
        </button>
        <button type="button" className="btn btn--ghost btn--small" disabled={saving.isLoading} onClick={onDone}>
          Отменить правку
        </button>
      </div>
    </div>
  );
}

const VIA: { id: SentVia; ru: string }[] = [
  { id: 'post', ru: 'Почтой' },
  { id: 'online', ru: 'Через онлайн-кабинет ведомства' },
  { id: 'email', ru: 'По e-mail' },
  { id: 'in_person', ru: 'Лично в ведомстве' },
  { id: 'other', ru: 'Другим способом' },
];

/** ДД.ММ.ГГГГ (точки или запятые с клавиатуры iPhone) → ГГГГ-ММ-ДД; существующая дата не позже сегодня. */
function parseSentDate(raw: string, today: string): { value: string } | { error: string } {
  const m = /^(\d{1,2})[.,](\d{1,2})[.,](\d{4})$/.exec(raw.trim());
  if (!m) return { error: 'Дата в формате ТТ.ММ.ГГГГ' };
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return { error: 'Такой даты нет' };
  const value = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (value > today) return { error: 'Дата отправки не может быть в будущем' };
  return { value };
}

/** Шаг 4: «Я отправил(а)» (B12). Ja!sno сам ничего не отправляет; отметка — со слов пользователя. */
export function AnswerSendPage({ caseId }: { caseId: string }) {
  const { draftId } = useAnswerParams();
  const c = useCaseDetailQuery(caseId);
  const d = useDraftQuery(draftId ?? '', { skip: !draftId });
  const [reportSent, sending] = useReportSentMutation();
  const navigate = useNavigate();
  const today = todayBerlin();
  const [via, setVia] = useState<SentVia | null>(null);
  const [rawDate, setRawDate] = useState(formatDate(today));
  const [dateTouched, setDateTouched] = useState(false);
  const [closeId, setCloseId] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Срок по умолчанию не закрывается: человек выбирает его явно (ТЗ v3 6.6).
  useEffect(() => setCloseId(''), [caseId]);

  if (c.isLoading || (draftId && d.isLoading)) return <Loading />;
  if (c.error || !c.data) return <ErrorAlert error={c.error} />;
  const draft = d.data && d.data.caseId === caseId ? d.data : null;
  const open = c.data.deadlines.filter((x) => x.active && !x.done);
  const parsed = parseSentDate(rawDate, today);
  const dateError = (dateTouched || submitted) && 'error' in parsed ? parsed.error : null;
  const viaError = submitted && !via ? 'Выберите, как вы отправили' : null;
  const back = draft ? draftUrl(caseId, draft) : `/app/cases/${caseId}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (!via || 'error' in parsed) return;
    setError(null);
    try {
      await reportSent({
        caseId,
        ...(draft && draft.status !== 'SENT' ? { draftId: draft.id } : {}),
        via,
        date: parsed.value,
        ...(closeId ? { closeDeadlineId: closeId } : {}),
      }).unwrap();
      navigate('/app/done', { replace: true });
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <PageHeader title="Отправьте ответ сами" back={back} />
      <div className="card stack">
        <span className="eyebrow">Как можно отправить</span>
        <ul style={{ margin: 0, paddingLeft: 20 }} className="stack-s">
          <li>Почтой: распечатайте, подпишите и отправьте на адрес из письма.</li>
          <li>Через онлайн-кабинет ведомства, если он у вас есть.</li>
          <li>Лично: отнесите в ведомство и попросите отметку о получении.</li>
        </ul>
        <p className="muted">Сохраните копию и дату отправки.</p>
      </div>
      {draft?.status === 'SENT' && (
        <div className="alert alert--info" role="status">
          Этот черновик уже отмечен как отправленный{draft.sentAt ? ` ${formatDate(draft.sentAt)}` : ''}.
        </div>
      )}
      <form className="card stack" onSubmit={(e) => void submit(e)} noValidate data-testid="sent-form">
        <h2 style={{ fontSize: 19 }}>Я отправил(а)</h2>
        <p className="small text-2">Это ваша отметка для дела. Ja!sno не знает, дошло ли письмо до ведомства.</p>
        <fieldset className="stack-s" style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={viaError ? 'via-error' : undefined} aria-invalid={viaError ? true : undefined}>
          <legend className="small" style={{ fontWeight: 600 }}>Как отправили</legend>
          {VIA.map((v) => (
            <label key={v.id} className="checkbox">
              <input type="radio" name="via" checked={via === v.id} onChange={() => setVia(v.id)} />
              <span>{v.ru}</span>
            </label>
          ))}
          {viaError && (
            <span id="via-error" className="field-error">
              {viaError}
            </span>
          )}
        </fieldset>
        <div className="field">
          <label htmlFor="sent-date">Когда (ТТ.ММ.ГГГГ)</label>
          <input
            id="sent-date"
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={rawDate}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? 'sent-date-error' : undefined}
            onChange={(e) => setRawDate(e.target.value)}
            onBlur={() => setDateTouched(true)}
          />
          {dateError && (
            <span id="sent-date-error" className="field-error">
              {dateError}
            </span>
          )}
        </div>
        {open.length > 0 && (
          <fieldset className="stack-s" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small" style={{ fontWeight: 600 }}>Отметить срок выполненным?</legend>
            <label className="checkbox">
              <input type="radio" name="close" checked={closeId === ''} onChange={() => setCloseId('')} />
              <span>Нет, срок не закрывать</span>
            </label>
            {open.map((x) => (
              <label key={x.id} className="checkbox">
                <input type="radio" name="close" checked={closeId === x.id} onChange={() => setCloseId(x.id)} />
                <span>Срок до {formatDate(x.date)} выполнен</span>
              </label>
            ))}
          </fieldset>
        )}
        <ErrorAlert error={error} />
        <button type="submit" className="btn btn--primary" disabled={sending.isLoading}>
          <Icon name="check" size={18} color="#FFFFFF" /> {sending.isLoading ? 'Сохраняем…' : 'Я отправил(а)'}
        </button>
      </form>
      <Link to={`/app/cases/${caseId}`} className="btn btn--secondary">
        Пока не отправил(а)
      </Link>
    </>
  );
}

export function DonePage() {
  return (
    <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
      <Illustration name="relief" height={220} blob="#DDEFEC" alt="Человек с облегчением выдыхает" />
      <h1 style={{ fontSize: 26 }}>Выдохните</h1>
      <p className="text-2">Всё нужное лежит в деле. Если придёт новое письмо, добавьте его туда же.</p>
      <Link to="/app" className="btn btn--primary">
        В кабинет
      </Link>
    </div>
  );
}
