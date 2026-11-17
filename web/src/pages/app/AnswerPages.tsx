import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { errorCode, errorText, isApiError } from '../../api/errors';
import type { ApiDraft, DraftKind, QuestionId } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { DemoNote, ErrorAlert, Loading, PageHeader } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { DRAFT_KIND } from '../../lib/labels';
import { useCaseDetailQuery, useCreateDraftMutation, useDraftQuery, useDraftQuestionsQuery } from '../../store/api';

/*
 * Ответ ведомству (F04): цель → готовый вопрос → черновик → «Скопировать».
 * Выбор живёт в URL (letter, q, amount, draft), поэтому переживает обновление страницы.
 * Черновик собирает сервер по шаблону из подтверждённых фактов (B10); Ja!sno сам ничего не отправляет.
 */

/** Параметры шага в URL. */
function useAnswerParams() {
  const [search] = useSearchParams();
  return {
    letterId: search.get('letter'),
    questionId: search.get('q') as QuestionId | null,
    amountClaimId: search.get('amount'),
    draftId: search.get('draft'),
  };
}

const qs = (p: Record<string, string | null | undefined>) =>
  new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();

/** Шаг 1: цель ответа и письмо, на которое отвечаем. */
export function AnswerGoalPage({ caseId }: { caseId: string }) {
  const c = useCaseDetailQuery(caseId);
  const { letterId } = useAnswerParams();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<string | null>(letterId);

  if (c.isLoading) return <Loading />;
  if (c.error || !c.data) return <ErrorAlert error={c.error} />;
  const letters = c.data.letters;
  const letter = chosen ?? (letters.length === 1 ? letters[0].id : null);

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
      <ul className="list-reset stack">
        {(Object.keys(DRAFT_KIND) as DraftKind[]).map((k) => {
          const d = DRAFT_KIND[k];
          return (
            <li key={k}>
              <button
                type="button"
                className="card row"
                disabled={!d.ready || !letter}
                style={{ width: '100%', textAlign: 'left', border: 0, cursor: d.ready ? 'pointer' : 'not-allowed', opacity: d.ready ? 1 : 0.6 }}
                onClick={() => navigate(`/app/cases/${caseId}/answer/details?${qs({ letter })}`)}
              >
                <Icon name="send" color="var(--c-teal)" />
                <span className="stack-s" style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{d.title}</span>
                  <span className="muted">{d.ready ? d.text : `${d.text}. Скоро`}</span>
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

/** Шаг 2: готовый вопрос. Доступные вопросы проверяет сервер. */
export function AnswerDetailsPage({ caseId }: { caseId: string }) {
  const { letterId, questionId, amountClaimId } = useAnswerParams();
  const q = useDraftQuestionsQuery(letterId ?? '', { skip: !letterId, refetchOnMountOrArgChange: true });
  const [createDraft, creating] = useCreateDraftMutation();
  const navigate = useNavigate();
  const [question, setQuestion] = useState<QuestionId | null>(questionId);
  const [amount, setAmount] = useState<string | null>(amountClaimId);
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
  const available = q.data.questions;
  const selected = question && available.some((x) => x.id === question) ? question : null;
  const needsAmount = selected === 'AMOUNT' && q.data.amounts.length > 1;

  async function submit() {
    if (!selected || !letterId) return;
    setError(null);
    try {
      const draft = await createDraft({
        caseId,
        letterId,
        questionId: selected,
        ...(selected === 'AMOUNT' && amount ? { amountClaimId: amount } : {}),
      }).unwrap();
      navigate(`/app/cases/${caseId}/answer/draft?${qs({ draft: draft.id, letter: letterId, q: selected, amount: selected === 'AMOUNT' ? amount : null })}`);
    } catch (err) {
      setError(err);
      void q.refetch(); // после ошибки — заново доступные вопросы
    }
  }

  return (
    <>
      <PageHeader title="Что именно непонятно?" subtitle="Выберите вопрос. Он войдёт в письмо на немецком." back={`/app/cases/${caseId}/answer?${qs({ letter: letterId })}`} />
      {available.length === 0 ? (
        <div className="alert alert--info">
          Нет подтверждённых фактов для вопроса. <Link to={`/app/letters/${letterId}/check`}>Проверьте факты письма</Link>.
        </div>
      ) : (
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
          {q.data.amounts.map((a) => (
            <label key={a.claimId} className="checkbox">
              <input type="radio" name="amount" checked={amount === a.claimId} onChange={() => setAmount(a.claimId)} />
              <span>{Number(a.value).toLocaleString('de-DE', { minimumFractionDigits: 2 })} €</span>
            </label>
          ))}
        </fieldset>
      )}
      {error ? <DraftError error={error} caseId={caseId} letterId={letterId} /> : null}
      <button
        type="button"
        className="btn btn--primary"
        disabled={!selected || (needsAmount && !amount) || creating.isLoading}
        onClick={() => void submit()}
      >
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
    if (!draft.letterId || !draft.questionId) return;
    setRebuildError(null);
    try {
      const fresh = await createDraft({
        caseId,
        letterId: draft.letterId,
        questionId: draft.questionId,
        ...(draft.questionId === 'AMOUNT' && amountClaimId ? { amountClaimId } : {}),
      }).unwrap();
      setCopy({ kind: 'idle' });
      navigate(
        `/app/cases/${caseId}/answer/draft?${qs({ draft: fresh.id, letter: draft.letterId, q: draft.questionId, amount: amountClaimId })}`,
        { replace: true },
      );
    } catch (err) {
      setRebuildError(err);
    }
  }

  const stale = draft.stale || copy.kind === 'blocked';

  return (
    <>
      <PageHeader title="Черновик ответа" subtitle="Проверьте текст, скопируйте и отправьте сами." back={`/app/cases/${caseId}`} />
      {stale && (
        <div className="alert alert--warn stack-s" role="alert" data-testid="draft-stale">
          <span>{copy.kind === 'blocked' ? copy.text : 'Данные изменились после сборки. Соберите черновик заново.'}</span>
          <button type="button" className="btn btn--primary btn--small" disabled={rebuilding.isLoading} onClick={() => void rebuild()}>
            Собрать заново
          </button>
        </div>
      )}
      {rebuildError ? <DraftError error={rebuildError} caseId={caseId} letterId={draft.letterId ?? ''} /> : null}

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

/** Шаг 4: отправка. Ja!sno сам ничего не отправляет. */
export function AnswerSendPage({ caseId }: { caseId: string }) {
  return (
    <>
      <PageHeader title="Отправьте ответ сами" back={`/app/cases/${caseId}/answer/draft`} />
      <div className="card stack">
        <span className="eyebrow">Как можно отправить</span>
        <ul style={{ margin: 0, paddingLeft: 20 }} className="stack-s">
          <li>Почтой: распечатайте, подпишите и отправьте на адрес из письма.</li>
          <li>Через онлайн-кабинет ведомства, если он у вас есть.</li>
          <li>Лично: отнесите в ведомство и попросите отметку о получении.</li>
        </ul>
        <p className="muted">Сохраните копию и дату отправки.</p>
      </div>
      <button type="button" className="btn btn--primary" disabled title="Появится к 03.12 (задача B12)">
        <Icon name="check" size={18} color="#FFFFFF" /> Я отправил(а)
      </button>
      <DemoNote>«Я отправил(а)» и «В календарь» появятся к 03.12</DemoNote>
      <Link to="/app/done" className="btn btn--secondary">
        Готово
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
