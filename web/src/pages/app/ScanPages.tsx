import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useBeforeUnload, useBlocker, useLocation, useNavigate } from 'react-router';
import { errorCode, errorText, isApiError, isDailyLimit } from '../../api/errors';
import type { CaseSuggestion, LetterClaim, LetterDetail } from '../../api/types';
import { useFlow } from '../../app/flow';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { ErrorAlert, Loading, PageHeader } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { CLAIM_KIND } from '../../lib/labels';
import {
  useAssignLetterMutation,
  useCasesQuery,
  useConfirmClaimsMutation,
  useCorrectClaimMutation,
  useDeleteLetterMutation,
  useLetterQuery,
  useUploadLetterMutation,
} from '../../store/api';
import { putUploadFiles } from '../../store/uploads';

/*
 * Загрузка письма и проверка фактов (F02). Пока одно фото или один PDF на письмо (B11 — несколько фото).
 * После загрузки письмо открывается по ID из URL (/app/letters/:id/check) и переживает обновление страницы.
 * Назначение в дело — задача B07.
 */

const MAX_FILE_MB = 10;
const ACCEPT = 'image/jpeg,image/png,application/pdf';

function Steps({ n }: { n: 1 | 2 | 3 }) {
  const labels = ['Файл', 'Чтение', 'Факты'];
  return (
    <ol className="list-reset row" aria-label={`Шаг ${n} из 3`} style={{ gap: 6 }}>
      {labels.map((l, i) => (
        <li key={l} style={{ flex: 1 }}>
          <span style={{ display: 'block', height: 5, borderRadius: 3, background: i < n ? 'var(--c-orange)' : 'var(--c-track)' }} />
          <span className="visually-hidden">{l}</span>
        </li>
      ))}
    </ol>
  );
}

/** Шаг 1: фото или файл. */
export function ScanStartPage() {
  const { pickFile } = useFlow();
  const navigate = useNavigate();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  function take(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) return setProblem(`Файл «${file.name}» больше ${MAX_FILE_MB} МБ.`);
    setProblem(null);
    pickFile(file);
    navigate('/app/scan/pages');
  }

  return (
    <>
      <PageHeader title="Новое письмо" back="/app" />
      <Steps n={1} />
      <div className="card card--peach stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <Illustration name="scan" height={200} blob="#FBE3D6" />
        <h2>Сфотографируйте письмо</h2>
        <p className="text-2 small">Положите лист на ровную поверхность при дневном свете. В кадре должны быть все края листа.</p>
      </div>
      <div className="alert alert--warn">Тестовая версия: загружайте только примеры писем, не настоящие документы.</div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => take(e.target.files)} />
      <input ref={picker} type="file" accept={ACCEPT} hidden data-testid="file-input" onChange={(e) => take(e.target.files)} />
      <button type="button" className="btn btn--primary" onClick={() => camera.current?.click()}>
        <Icon name="camera" size={20} color="#FFFFFF" width={2.2} /> Сделать фото
      </button>
      <button type="button" className="btn btn--secondary" onClick={() => picker.current?.click()}>
        <Icon name="upload" size={20} /> Выбрать фото или PDF
      </button>
      {problem && (
        <div className="alert alert--error" role="alert">
          {problem}
        </div>
      )}
      <p className="muted">JPG, PNG или PDF с текстом, до {MAX_FILE_MB} МБ. Пока одно фото или один PDF на письмо.</p>
    </>
  );
}

/** Шаг 2: проверить файл перед отправкой. */
export function ScanPagesPage() {
  const { picked, clearFile } = useFlow();
  const navigate = useNavigate();
  if (!picked) return <Navigate to="/app/scan" replace />;
  const isPdf = picked.file.type === 'application/pdf';

  return (
    <>
      <PageHeader title="Проверьте файл" back="/app/scan" />
      <Steps n={1} />
      <div className="thumbs">
        <div className="thumb">{isPdf ? <Icon name="doc" size={40} color="var(--c-teal)" /> : <img src={picked.url} alt="Снимок письма" />}</div>
      </div>
      <p className="text-2 small">{isPdf ? 'PDF: Ja!sno прочитает текст из файла.' : 'Текст на снимке должен читаться целиком.'}</p>
      <button type="button" className="btn btn--primary" onClick={() => navigate('/app/scan/reading')}>
        Готово, читать письмо
      </button>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={() => {
          clearFile();
          navigate('/app/scan', { replace: true });
        }}
      >
        Выбрать другой файл
      </button>
    </>
  );
}

/** Ошибки файла: нужен другой файл. Остальные: занято, нет связи, результат неизвестен. */
const FILE_PROBLEMS = new Set([
  'UNREADABLE',
  'SCAN_PDF_NOT_SUPPORTED',
  'FILE_TOO_LARGE',
  'LETTER_TOO_LARGE',
  'UNSUPPORTED_TYPE',
  'PDF_ENCRYPTED',
  'FILE_DAMAGED',
  'NO_FILE',
  'TOO_MANY_FILES',
  'VALIDATION_FAILED',
]);

type UploadProblem = 'file' | 'busy' | 'network' | 'unknown' | 'model';

export function uploadProblem(error: unknown): UploadProblem {
  const code = errorCode(error) ?? '';
  if (FILE_PROBLEMS.has(code)) return 'file';
  if (code === 'LLM_QUOTA' || code === 'RATE_LIMITED') return 'busy';
  if (code === 'NETWORK') return 'network';
  if (code === 'LLM_FAILED') return 'model';
  return 'unknown'; // TIMEOUT, CANCELLED, 5xx: письмо могло сохраниться
}

/** Шаг 2: Ja!sno читает. Запрос отправляется один раз, повтор только по кнопке и только если письмо точно не сохранено. */
export function ScanReadingPage() {
  const [uploadLetter] = useUploadLetterMutation();
  const { picked, clearFile } = useFlow();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef<string | null>(null);

  useEffect(() => {
    if (!picked) return;
    const key = `${picked.url}#${attempt}`;
    if (started.current === key) return; // защита от двойной отправки
    started.current = key;
    setError(null);
    uploadLetter(putUploadFiles([picked.file]))
      .unwrap()
      .then(async (r) => {
        // Сначала переход (сразу, flushSync), потом очистка файла: иначе страница чтения сама уйдёт на начало.
        await navigate(`/app/letters/${r.letter.id}/check`, {
          replace: true,
          flushSync: true,
          state: { dropped: r.extraction.dropped, suggestions: r.suggestions },
        });
        clearFile();
      })
      .catch(setError);
  }, [attempt, picked, uploadLetter, clearFile, navigate]);

  if (!picked && !error) return <Navigate to="/app/scan" replace />;
  const problem = error ? uploadProblem(error) : null;
  const again = () => {
    clearFile();
    navigate('/app/scan', { replace: true });
  };

  return (
    <>
      <PageHeader title="Ja!sno читает письмо" />
      <Steps n={2} />
      <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <Illustration name="talk" height={180} blob="#DDEFEC" />
        {!error && (
          <>
            <div className="spinner" role="status" aria-label="Идёт чтение" />
            <p className="text-2">Читаем текст и ищем факты с цитатами. Обычно это до минуты.</p>
          </>
        )}
        {problem === 'file' && (
          <>
            <ErrorAlert error={error} />
            <button type="button" className="btn btn--primary btn--small" onClick={again}>
              Выбрать другой файл
            </button>
          </>
        )}
        {problem === 'busy' && (
          <>
            <div className="alert alert--warn" role="alert" style={{ width: '100%' }} data-testid="upload-busy">
              {errorText(error)}. Письмо не сохранено{isDailyLimit(error) ? '.' : ', файл остался выбранным.'}
            </div>
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              {/* B18: при дневном лимите повтор сразу бесполезен — кнопки нет */}
              {!isDailyLimit(error) && (
                <button type="button" className="btn btn--primary btn--small" onClick={() => setAttempt((a) => a + 1)}>
                  Попробовать ещё раз
                </button>
              )}
              <Link to="/app" className="btn btn--secondary btn--small">
                В кабинет
              </Link>
            </div>
          </>
        )}
        {problem === 'model' && (
          <>
            <ErrorAlert error={error} />
            <p className="small text-2">Письмо не сохранено.</p>
            <button type="button" className="btn btn--primary btn--small" onClick={() => setAttempt((a) => a + 1)}>
              Попробовать ещё раз
            </button>
          </>
        )}
        {(problem === 'network' || problem === 'unknown') && (
          <>
            <div className="alert alert--warn" role="alert" style={{ width: '100%' }} data-testid="upload-unknown">
              {problem === 'network' ? 'Связь с сервером прервалась.' : 'Сервер не ответил вовремя.'} Письмо могло успеть сохраниться.
              Сначала проверьте входящие в кабинете, чтобы не загрузить его дважды.
            </div>
            <Link to="/app" className="btn btn--primary btn--small">
              Проверить входящие
            </Link>
          </>
        )}
      </div>
    </>
  );
}

// ---------- Проверка фактов ----------

type Decision = 'ok' | 'wrong';

const DEADLINE_KIND: Record<string, string> = {
  REPLY: 'ответить',
  DOCUMENTS: 'прислать документы',
  OBJECTION: 'возражение',
  FOLLOW_UP: 'напоминание',
};

/** Состояние факта по данным сервера. Локальная отметка «Верно» статус не меняет. */
function ClaimStatusChip({ claim }: { claim: LetterClaim }) {
  if (claim.status === 'CONFIRMED') return <span className="status status--done">Подтверждено</span>;
  if (claim.status === 'REJECTED') return <span className="status status--overdue">Отклонено</span>;
  if (claim.basis === 'USER') return <span className="status status--check">Исправлено вами</span>;
  return <span className="status status--check">Нужно проверить</span>;
}

/** Даты с точками или запятыми → ГГГГ-ММ-ДД, сумма с запятой → с точкой. */
export function parseUserValue(kind: LetterClaim['kind'], raw: string): { value: string } | { error: string } {
  const v = raw.trim();
  if (!v) return { error: 'Введите значение' };
  if (kind === 'DEADLINE' || kind === 'LETTER_DATE') {
    const m = /^(\d{1,2})[.,](\d{1,2})[.,](\d{4})$/.exec(v);
    if (!m) return { error: 'Дата в формате ТТ.ММ.ГГГГ' };
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return { error: 'Такой даты нет' };
    return { value: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
  }
  if (kind === 'AMOUNT') {
    const n = v.replace(/\s|€|EUR/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(n)) return { error: 'Сумма числом, например 120,50' };
    return { value: n };
  }
  return { value: v };
}

function CorrectForm({ claim, letterId, onDone }: { claim: LetterClaim; letterId: string; onDone: (newDetail: LetterDetail | null, error?: unknown) => void }) {
  const [correctClaim, state] = useCorrectClaimMutation();
  const isDate = claim.kind === 'DEADLINE' || claim.kind === 'LETTER_DATE';
  const [raw, setRaw] = useState(isDate ? formatDate(claim.value) : claim.value);
  const [problem, setProblem] = useState<string | null>(null);
  const id = `fix-${claim.id}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseUserValue(claim.kind, raw);
    if ('error' in parsed) return setProblem(parsed.error);
    setProblem(null);
    try {
      onDone(await correctClaim({ id: letterId, claimId: claim.id, value: parsed.value }).unwrap());
    } catch (err) {
      onDone(null, err);
    }
  }

  return (
    <form className="stack-s" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor={id}>{isDate ? 'Верная дата (ТТ.ММ.ГГГГ)' : 'Верное значение'}</label>
        <input
          id={id}
          className="input"
          value={raw}
          inputMode={isDate || claim.kind === 'AMOUNT' ? 'decimal' : undefined}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-error` : undefined}
          onChange={(e) => setRaw(e.target.value)}
        />
        {problem && (
          <span id={`${id}-error`} className="field-error">
            {problem}
          </span>
        )}
      </div>
      <div className="row wrap">
        <button type="submit" className="btn btn--navy btn--small" disabled={state.isLoading}>
          Сохранить исправление
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => onDone(null)}>
          Отмена
        </button>
      </div>
    </form>
  );
}

/** Шаг 3: проверка фактов письма. Решения до «Сохранить проверку» живут только на этой странице. */
export function LetterCheckPage({ id }: { id: string }) {
  const q = useLetterQuery(id);
  const location = useLocation();
  const navigate = useNavigate();
  const fromUpload = (location.state ?? null) as { dropped?: number; suggestions?: CaseSuggestion[] } | null;
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error' | 'warn'; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirmClaims, saving] = useConfirmClaimsMutation();
  const [deleteLetter, deleting] = useDeleteLetterMutation();
  const [askDelete, setAskDelete] = useState(false);

  const pending = Object.keys(decisions).length;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => pending > 0 && currentLocation.pathname !== nextLocation.pathname);
  useBeforeUnload((e) => {
    if (pending > 0) e.preventDefault();
  });

  // Решения только для фактов, которые сервер ещё считает непроверенными.
  useEffect(() => {
    if (!q.data) return;
    const open = new Set(q.data.claims.filter((c) => c.status === 'UNCONFIRMED').map((c) => c.id));
    setDecisions((d) => {
      const kept = Object.fromEntries(Object.entries(d).filter(([cid]) => open.has(cid)));
      return Object.keys(kept).length === Object.keys(d).length ? d : kept;
    });
  }, [q.data]);

  if (q.isLoading) return <Loading text="Загружаем письмо…" />;
  if (q.error || !q.data) {
    const notFound = errorCode(q.error) === 'NOT_FOUND';
    return (
      <>
        <PageHeader title={notFound ? 'Письмо не найдено' : 'Не получилось открыть письмо'} back="/app" />
        {!notFound && <ErrorAlert error={q.error} />}
        <Link to="/app" className="btn btn--secondary">
          В кабинет
        </Link>
      </>
    );
  }

  const { claims, deadlines, letter } = q.data;
  const decide = (cid: string, d: Decision) =>
    setDecisions((x) => {
      if (x[cid] === d) {
        const { [cid]: _drop, ...rest } = x;
        return rest;
      }
      return { ...x, [cid]: d };
    });

  async function save(): Promise<boolean> {
    setNotice(null);
    setConflict(false);
    const confirm = Object.keys(decisions).filter((cid) => decisions[cid] === 'ok');
    const reject = Object.keys(decisions).filter((cid) => decisions[cid] === 'wrong');
    try {
      await confirmClaims({ id, confirm, reject }).unwrap();
      setDecisions({});
      setNotice({ tone: 'info', text: 'Проверка сохранена.' });
      return true;
    } catch (err) {
      if (errorCode(err) === 'CLAIM_STATE') setConflict(true);
      else setNotice({ tone: 'error', text: errorText(err) });
      return false;
    }
  }

  function afterCorrect(claim: LetterClaim, detail: LetterDetail | null, err?: unknown) {
    setEditing(null);
    if (err) {
      if (errorCode(err) === 'CLAIM_STATE') setConflict(true);
      else setNotice({ tone: 'error', text: isApiError(err) ? err.message : errorText(err) });
      return;
    }
    if (!detail) return;
    // Решение по заменённой версии убираем, решения по остальным фактам сохраняются.
    setDecisions((x) => {
      const { [claim.id]: _old, ...rest } = x;
      return rest;
    });
    setNotice({ tone: 'info', text: 'Исправление сохранено. Подтвердите новое значение.' });
  }

  async function remove() {
    try {
      setDecisions({});
      await deleteLetter(id).unwrap();
      await navigate('/app', { replace: true, flushSync: true });
    } catch (err) {
      setNotice({ tone: 'error', text: errorText(err) });
    }
  }

  const dropped = fromUpload?.dropped ?? 0;

  return (
    <>
      <PageHeader title="Проверьте факты" subtitle="Сравните с письмом. Ja!sno показывает только то, что нашло дословно в тексте." back="/app" />
      <Steps n={3} />

      {blocker.state === 'blocked' && (
        <div className="alert alert--warn stack-s" role="alertdialog" aria-label="Несохранённые решения">
          <span>Есть несохранённые решения ({pending}). Уйти без сохранения?</span>
          <div className="row wrap">
            <button type="button" className="btn btn--secondary btn--small" onClick={() => blocker.reset()}>
              Остаться
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => blocker.proceed()}>
              Уйти без сохранения
            </button>
          </div>
        </div>
      )}

      {conflict && (
        <div className="alert alert--error stack-s" role="alert" data-testid="conflict">
          <span>Факты изменились в другом окне или уже сохранены. Ничего не записано.</span>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => {
              setConflict(false);
              void q.refetch();
            }}
          >
            Перечитать данные
          </button>
        </div>
      )}
      {notice && (
        <div className={`alert alert--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </div>
      )}

      {claims.length === 0 ? (
        <section className="card stack" data-testid="no-facts">
          <h2 style={{ fontSize: 19 }}>Факты не найдены</h2>
          <p className="text-2">
            Ja!sno прочитало письмо, но не нашло в тексте ведомство, номер дела, даты или требования с цитатой. Это не ошибка: посмотрите текст
            письма ниже или в оригинале.
          </p>
        </section>
      ) : (
        <ul className="list-reset stack" aria-label="Факты письма">
          {claims.map((c) => {
            const d = decisions[c.id];
            return (
              <li key={c.id} className="card stack-s" data-testid="claim">
                <div className="row-between">
                  <span className="small text-2">{CLAIM_KIND[c.kind] ?? c.kind}</span>
                  <ClaimStatusChip claim={c} />
                </div>
                <strong>{c.text}</strong>
                {c.relativeDeadline && <span className="small">Точную дату нужно уточнить: она зависит от дня получения письма.</span>}
                {c.quote ? (
                  <blockquote className="small text-2" style={{ margin: 0 }}>
                    «{c.quote}»{c.page ? ` · стр. ${c.page}` : ''}
                  </blockquote>
                ) : c.basis === 'USER' ? (
                  <span className="small text-2">Указано вами, цитаты из письма нет.</span>
                ) : null}
                {editing === c.id ? (
                  <CorrectForm claim={c} letterId={id} onDone={(detail, err) => afterCorrect(c, detail, err)} />
                ) : (
                  <div className="row wrap">
                    {c.status === 'UNCONFIRMED' && (
                      <>
                        <button
                          type="button"
                          className={`btn btn--small ${d === 'ok' ? 'btn--teal' : 'btn--secondary'}`}
                          aria-pressed={d === 'ok'}
                          onClick={() => decide(c.id, 'ok')}
                        >
                          <Icon name="check" size={16} /> Верно
                        </button>
                        <button
                          type="button"
                          className={`btn btn--small ${d === 'wrong' ? 'btn--navy' : 'btn--secondary'}`}
                          aria-pressed={d === 'wrong'}
                          onClick={() => decide(c.id, 'wrong')}
                        >
                          Неверно
                        </button>
                      </>
                    )}
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing(c.id)}>
                      Исправить
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dropped > 0 && (
        <div className="alert alert--info" data-testid="dropped">
          Ещё {dropped} {dropped === 1 ? 'значение не прошло' : 'значения не прошли'} проверку: их не было дословно в тексте письма, поэтому Ja!sno
          их не показывает.
        </div>
      )}

      {deadlines.length > 0 && (
        <section className="stack-s" aria-label="Сроки">
          <h2 style={{ fontSize: 19 }}>Сроки</h2>
          {deadlines.map((dl) => (
            <div key={dl.id} className="card row-between" data-testid="deadline">
              <span>
                до {formatDate(dl.date)} · {DEADLINE_KIND[dl.kind] ?? dl.kind}
              </span>
              {dl.active ? (
                <span className="status status--action">Действует</span>
              ) : (
                <span className="status status--check">Кандидат: подтвердите срок</span>
              )}
            </div>
          ))}
        </section>
      )}

      {claims.length > 0 && (
        <button type="button" className="btn btn--primary" disabled={pending === 0 || saving.isLoading} onClick={() => void save()}>
          {saving.isLoading ? 'Сохраняем…' : `Сохранить проверку${pending ? ` (${pending})` : ''}`}
        </button>
      )}

      <details className="card">
        <summary>Текст письма</summary>
        <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
          {letter.text}
        </pre>
      </details>

      <section className="card stack-s" aria-label="Что дальше">
        <h2 style={{ fontSize: 19 }}>Что дальше</h2>
        {(fromUpload?.suggestions ?? []).map((s) => (
          <span key={s.caseId} className="small text-2">
            Похоже на дело «{s.title}»: {s.reason}.
          </span>
        ))}
        <AssignBlock
          letterId={id}
          suggestions={fromUpload?.suggestions ?? []}
          pending={pending}
          onSave={save}
          onDiscard={() => setDecisions({})}
          onError={(text) => setNotice({ tone: 'error', text })}
        />
        <button type="button" className="btn btn--secondary btn--small" onClick={() => navigate('/app')}>
          Оставить во входящих
        </button>
        {!askDelete ? (
          <button type="button" className="btn btn--danger btn--small" onClick={() => setAskDelete(true)}>
            <Icon name="trash" size={16} /> Удалить письмо
          </button>
        ) : (
          <div className="alert alert--error stack-s" role="alertdialog" aria-label="Удалить письмо">
            <span>Удалить письмо, его факты и файл безвозвратно?</span>
            <div className="row wrap">
              <button type="button" className="btn btn--danger btn--small" disabled={deleting.isLoading} onClick={remove}>
                Удалить безвозвратно
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setAskDelete(false)}>
                Отмена
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * «В дело»: подсказка по номеру дела, открытое дело или новое.
 * Несохранённые решения не теряются молча: сначала «Сохранить и положить» или «Отменить решения».
 */
function AssignBlock({
  letterId,
  suggestions,
  pending,
  onSave,
  onDiscard,
  onError,
}: {
  letterId: string;
  suggestions: CaseSuggestion[];
  pending: number;
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
  onError: (text: string) => void;
}) {
  const cases = useCasesQuery();
  const [assignLetter, assigning] = useAssignLetterMutation();
  const navigate = useNavigate();
  const open = (cases.data ?? []).filter((c) => c.stage !== 'CLOSED');
  const options = [
    ...suggestions.map((s) => ({ id: s.caseId, title: s.title, note: s.reason })),
    ...open.filter((c) => !suggestions.some((s) => s.caseId === c.id)).map((c) => ({ id: c.id, title: c.title, note: c.caseNumber ?? '' })),
  ];
  const [choice, setChoice] = useState<string>(suggestions[0]?.caseId ?? 'new');
  const [title, setTitle] = useState('');
  const [askPending, setAskPending] = useState(false);

  async function assign() {
    try {
      const target = choice === 'new' ? { newCase: title.trim() ? { title: title.trim() } : {} } : { caseId: choice };
      await assignLetter({ id: letterId, target }).unwrap();
      await navigate('/app', { replace: true, flushSync: true });
    } catch (err) {
      onError(errorText(err));
    }
  }

  async function start() {
    if (pending > 0) return setAskPending(true);
    await assign();
  }

  return (
    <fieldset className="stack-s" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="small text-2">Положить письмо в дело</legend>
      {options.map((o) => (
        <label key={o.id} className="checkbox">
          <input type="radio" name="case" checked={choice === o.id} onChange={() => setChoice(o.id)} />
          <span>
            {o.title}
            {o.note ? <span className="small text-2"> · {o.note}</span> : null}
          </span>
        </label>
      ))}
      <label className="checkbox">
        <input type="radio" name="case" checked={choice === 'new'} onChange={() => setChoice('new')} />
        <span>Новое дело</span>
      </label>
      {choice === 'new' && (
        <div className="field">
          <label htmlFor="new-case-title">Название (необязательно)</label>
          <input
            id="new-case-title"
            className="input"
            value={title}
            maxLength={120}
            placeholder="Из подтверждённых фактов или «Новое дело»"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      )}
      {askPending && pending > 0 ? (
        <div className="alert alert--warn stack-s" role="alertdialog" aria-label="Несохранённые решения перед делом">
          <span>Есть несохранённые решения ({pending}). Сохранить их перед тем, как положить письмо в дело?</span>
          <div className="row wrap">
            <button
              type="button"
              className="btn btn--primary btn--small"
              disabled={assigning.isLoading}
              onClick={async () => {
                if (await onSave()) await assign();
              }}
            >
              Сохранить и положить
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => {
                onDiscard();
                setAskPending(false);
              }}
            >
              Отменить решения
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--primary btn--small" disabled={assigning.isLoading} onClick={() => void start()}>
          В дело
        </button>
      )}
    </fieldset>
  );
}
