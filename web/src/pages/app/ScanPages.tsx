import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useBeforeUnload, useBlocker, useLocation, useNavigate } from 'react-router';
import { errorCode, errorText, isApiError, isDailyLimit } from '../../api/errors';
import type { CaseSuggestion, LetterClaim, LetterDetail } from '../../api/types';
import { MAX_PAGES, useFlow } from '../../app/flow';
import { shrinkAll } from '../../lib/shrinkImage';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { AiConsentCard } from '../../components/consent';
import { LetterOriginals } from '../../components/LetterOriginals';
import { ErrorAlert, Loading, PageHeader } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { CLAIM_KIND } from '../../lib/labels';
import {
  useAssignLetterMutation,
  useCabinetQuery,
  useCasesQuery,
  useConfirmClaimsMutation,
  useCorrectClaimMutation,
  useDeleteLetterMutation,
  useLetterQuery,
  useUploadLetterMutation,
} from '../../store/api';
import { putUploadFiles } from '../../store/uploads';
import { t, tMsg, tn } from '../../i18n';

/*
 * Загрузка письма и проверка фактов (F02, B11). Один PDF или до 10 фото страниц одного письма.
 * После загрузки письмо открывается по ID из URL (/app/letters/:id/check) и переживает обновление страницы.
 * Файлы и превью живут вне Redux (FlowProvider).
 */

const MAX_FILE_MB = 10;
const MAX_LETTER_MB = 20;
const ACCEPT = 'image/jpeg,image/png,application/pdf';
const MB = 1024 * 1024;

/** Проверка размера до отправки: файл до 10 МБ, все файлы письма до 20 МБ (сервер проверяет сам). */
function sizeProblem(files: File[], already: File[]): string | null {
  const big = files.find((f) => f.size > MAX_FILE_MB * MB);
  if (big) return t('Файл «{v0}» больше {v1} МБ.', { v0: big.name, v1: MAX_FILE_MB });
  const pdf = files.some((f) => f.type === 'application/pdf');
  const total = [...(pdf ? [] : already), ...files].reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_LETTER_MB * MB) return t('Все файлы письма вместе больше {v0} МБ.', { v0: MAX_LETTER_MB });
  return null;
}

/** Скрытые поля выбора: камера (по одному снимку) и файлы (несколько фото или один PDF). */
function useFilePickers(onFiles: (files: File[]) => void) {
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const take = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = ''; // тот же файл можно выбрать снова
    if (files.length) onFiles(files);
  };
  const inputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => take(e.target)} />
      <input ref={picker} type="file" accept={ACCEPT} multiple hidden data-testid="file-input" onChange={(e) => take(e.target)} />
    </>
  );
  return { inputs, openCamera: () => camera.current?.click(), openPicker: () => picker.current?.click() };
}

function Steps({ n }: { n: 1 | 2 | 3 }) {
  const labels = [t('Файл'), t('Чтение'), t('Факты')];
  return (
    <ol className="list-reset row" aria-label={t('Шаг {v0} из 3', { v0: n })} style={{ gap: 6 }}>
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
  const { pages, addFiles } = useFlow();
  const cabinet = useCabinetQuery();
  const navigate = useNavigate();
  const [problem, setProblem] = useState<string | null>(null);
  const { inputs, openCamera, openPicker } = useFilePickers((files) => {
    const tooBig = sizeProblem(files, []);
    if (tooBig) return setProblem(tooBig);
    setProblem(null);
    const note = addFiles(files);
    navigate('/app/scan/pages', { state: note ? { note } : undefined });
  });

  return (
    <>
      <PageHeader title={t('Новое письмо')} back="/app" />
      <Steps n={1} />
      <div className="card card--peach stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <Illustration name="scan" height={200} blob="#FBE3D6" />
        <h2>{t('Сфотографируйте письмо')}</h2>
        <p className="text-2 small">
          {t('Положите лист на ровную поверхность при дневном свете. В кадре должны быть все края листа. Письмо на нескольких страницах: сфотографируйте каждую.')}
        </p>
      </div>
      <div className="alert alert--warn">{t('Тестовая версия: загружайте только примеры писем, не настоящие документы.')}</div>
      {/* K11: без согласия на анализ ИИ вместо кнопок загрузки — согласие */}
      {cabinet.data && !cabinet.data.aiConsent.given ? (
        <AiConsentCard />
      ) : (
        <>
      {inputs}
      <button type="button" className="btn btn--primary" onClick={openCamera}>
        <Icon name="camera" size={20} color="#FFFFFF" width={2.2} />{' '}{t('Сделать фото')}
      </button>
      <button type="button" className="btn btn--secondary" onClick={openPicker}>
        <Icon name="upload" size={20} />{' '}{t('Выбрать фото или PDF')}
      </button>
      {pages.length > 0 && (
        <Link to="/app/scan/pages" className="link">
          {t('Вернуться к выбранным страницам (')}{pages.length})
        </Link>
      )}
        </>
      )}
      {problem && (
        <div className="alert alert--error" role="alert">
          {problem}
        </div>
      )}
      <p className="muted">
        {t('JPG, PNG или PDF (с текстом или скан), файл до')}{' '}{MAX_FILE_MB}{' '}{t('МБ. Одно письмо: до 10 фото страниц или один PDF до 20 страниц.')}
      </p>
    </>
  );
}

/** Шаг 1б: проверка снимков — порядок страниц, убрать, добавить (B11, макет стр. 10). */
export function ScanPagesPage() {
  const { pages, addFiles, removePage, movePage, clearFiles } = useFlow();
  const navigate = useNavigate();
  const location = useLocation();
  const [problem, setProblem] = useState<string | null>((location.state as { note?: string } | null)?.note ?? null);
  const { inputs, openCamera, openPicker } = useFilePickers((files) => {
    const tooBig = sizeProblem(files, pages.map((p) => p.file));
    if (tooBig) return setProblem(tooBig);
    setProblem(addFiles(files));
  });
  if (pages.length === 0) return <Navigate to="/app/scan" replace />;
  const pdf = pages.length === 1 && pages[0].file.type === 'application/pdf';
  const full = pages.length >= MAX_PAGES;

  return (
    <>
      <PageHeader title={pdf ? t('Проверьте файл') : t('Проверьте снимки')} back="/app/scan" />
      <Steps n={1} />
      {inputs}
      {pdf ? (
        <>
          <div className="thumbs">
            <div className="thumb">
              <Icon name="doc" size={40} color="var(--c-teal)" />
            </div>
          </div>
          <p className="text-2 small">
            PDF «{pages[0].file.name}{t('». Ja!sno прочитает текст из файла, страницы-сканы распознает как фото.')}
          </p>
        </>
      ) : (
        <>
          <p className="text-2 small">
            {tn('{n} страница.|{n} страницы.|{n} страниц.', pages.length)}{' '}{t('Порядок как в письме: страница 1 сверху. Текст на каждом снимке должен читаться целиком.')}
          </p>
          <ol className="list-reset scan-pages" aria-label={t('Страницы письма')}>
            {pages.map((p, i) => (
              <li key={p.id} className="card scan-page" data-testid="scan-page">
                <div className="thumb">
                  <img src={p.url} alt={t('Страница {v0}', { v0: i + 1 })} />
                  <span className="thumb-n" aria-hidden="true">
                    {i + 1}
                  </span>
                </div>
                <div className="stack-s scan-page-actions">
                  <span className="small">{t('Страница')}{' '}{i + 1}</span>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    disabled={i === 0}
                    aria-label={t('Страница {v0}: выше', { v0: i + 1 })}
                    onClick={() => movePage(p.id, -1)}
                  >
                    {t('↑ Выше')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    disabled={i === pages.length - 1}
                    aria-label={t('Страница {v0}: ниже', { v0: i + 1 })}
                    onClick={() => movePage(p.id, 1)}
                  >
                    {t('↓ Ниже')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--small"
                    aria-label={t('Убрать страницу {v0}', { v0: i + 1 })}
                    onClick={() => removePage(p.id)}
                  >
                    <Icon name="trash" size={16} />{' '}{t('Убрать')}
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {full ? (
            <p className="muted">{t('Это максимум:')}{' '}{MAX_PAGES}{' '}{t('фото на письмо.')}</p>
          ) : (
            <div className="row wrap">
              <button type="button" className="btn btn--secondary btn--small" onClick={openCamera}>
                <Icon name="camera" size={18} />{' '}{t('Снять ещё страницу')}
              </button>
              <button type="button" className="btn btn--secondary btn--small" onClick={openPicker}>
                <Icon name="plus" size={18} />{' '}{t('Добавить фото')}
              </button>
            </div>
          )}
        </>
      )}
      {problem && (
        <div className="alert alert--warn" role="alert">
          {problem}
        </div>
      )}
      <button type="button" className="btn btn--primary" onClick={() => navigate('/app/scan/reading')}>
        {t('Готово, читать письмо')}
      </button>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={() => {
          clearFiles();
          navigate('/app/scan', { replace: true });
        }}
      >
        {pdf ? t('Выбрать другой файл') : t('Начать заново')}
      </button>
    </>
  );
}

/** Ошибки файла: нужен другой файл. Остальные: занято, нет связи, результат неизвестен. */
const FILE_PROBLEMS = new Set([
  'UNREADABLE',
  'SCAN_PDF_NOT_SUPPORTED',
  'MIXED_FILES',
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
  const { pages, clearFiles } = useFlow();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef<string | null>(null);
  // Поправка 9 (23.11): видно, сколько секунд идёт чтение, и его можно отменить
  const [seconds, setSeconds] = useState(0);
  const request = useRef<{ abort: () => void } | null>(null);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    if (error || cancelled) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [attempt, error, cancelled]);

  useEffect(() => {
    if (pages.length === 0) return;
    const key = `${pages.map((p) => p.id).join(',')}#${attempt}`;
    if (started.current === key) return; // защита от двойной отправки
    started.current = key;
    setError(null);
    setCancelled(false);
    void (async () => {
      // большие фото уменьшаются в браузере перед отправкой
      const files = await shrinkAll(pages.map((p) => p.file));
      if (started.current !== key) return; // отменили, пока готовили файлы
      const sent = uploadLetter(putUploadFiles(files));
      request.current = sent;
      return sent.unwrap();
    })()
      .then(async (r) => {
        if (!r) return;
        // Сначала переход (сразу, flushSync), потом очистка файла: иначе страница чтения сама уйдёт на начало.
        await navigate(`/app/letters/${r.letter.id}/check`, {
          replace: true,
          flushSync: true,
          state: { dropped: r.extraction.dropped, suggestions: r.suggestions },
        });
        clearFiles();
      })
      .catch((e: unknown) => {
        if (errorCode(e) === 'CANCELLED') return; // «Отменить»: экран уже ушёл к снимкам
        setError(e);
      })
      .finally(() => {
        request.current = null;
      });
  }, [attempt, pages, uploadLetter, clearFiles, navigate]);

  const cancel = () => {
    setCancelled(true);
    started.current = null;
    request.current?.abort();
    // снимки остаются выбранными: можно убрать лишние или отправить ещё раз
    void navigate('/app/scan/pages', {
      replace: true,
      state: { note: t('Чтение отменено. Если письмо успело сохраниться, оно появится во входящих в кабинете.') },
    });
  };

  if (pages.length === 0 && !error) return <Navigate to="/app/scan" replace />;
  const problem = error ? uploadProblem(error) : null;
  const again = () => {
    clearFiles();
    navigate('/app/scan', { replace: true });
  };
  // B11: не читается одна из нескольких страниц — вернуться к снимкам и переснять только её
  const badPages = errorCode(error) === 'UNREADABLE' && isApiError(error) ? ((error.details as { pages?: number[] } | undefined)?.pages ?? []) : [];
  const several = pages.length > 1;

  return (
    <>
      <PageHeader title={t('Ja!sno читает письмо')} />
      <Steps n={2} />
      <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <Illustration name="talk" height={180} blob="#DDEFEC" />
        {!error && (
          <>
            <div className="spinner" role="status" aria-label={t('Идёт чтение')} />
            <p className="text-2">{t('Читаем текст и ищем факты с цитатами. Обычно это до минуты.')}</p>
            <p className="small text-2" data-testid="reading-seconds" aria-live="off">
              {t('Прошло')}{' '}{seconds}{' '}{t('с')}{seconds >= 90 ? t('. Долго: возможно, слабая связь или большое письмо.') : ''}
            </p>
            <button type="button" className="btn btn--secondary btn--small" onClick={cancel} data-testid="reading-cancel">
              {t('Отменить')}
            </button>
          </>
        )}
        {problem === 'file' && (
          <>
            <ErrorAlert error={error} />
            {several && badPages.length > 0 && (
              <p className="small text-2">{t('Письмо не сохранено. Уберите эту страницу и снимите её заново, остальные останутся.')}</p>
            )}
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              {several && (
                <button type="button" className="btn btn--primary btn--small" onClick={() => navigate('/app/scan/pages', { replace: true })}>
                  {t('Вернуться к снимкам')}
                </button>
              )}
              <button type="button" className={several ? 'btn btn--secondary btn--small' : 'btn btn--primary btn--small'} onClick={again}>
                {several ? t('Начать заново') : t('Выбрать другой файл')}
              </button>
            </div>
          </>
        )}
        {problem === 'busy' && (
          <>
            <div className="alert alert--warn" role="alert" style={{ width: '100%' }} data-testid="upload-busy">
              {errorText(error)}{t('. Письмо не сохранено')}{isDailyLimit(error) ? '.' : t(', файл остался выбранным.')}
            </div>
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              {/* B18: при дневном лимите повтор сразу бесполезен — кнопки нет */}
              {!isDailyLimit(error) && (
                <button type="button" className="btn btn--primary btn--small" onClick={() => setAttempt((a) => a + 1)}>
                  {t('Попробовать ещё раз')}
                </button>
              )}
              <Link to="/app" className="btn btn--secondary btn--small">
                {t('В кабинет')}
              </Link>
            </div>
          </>
        )}
        {problem === 'model' && (
          <>
            <ErrorAlert error={error} />
            <p className="small text-2">{t('Письмо не сохранено.')}</p>
            <button type="button" className="btn btn--primary btn--small" onClick={() => setAttempt((a) => a + 1)}>
              {t('Попробовать ещё раз')}
            </button>
          </>
        )}
        {(problem === 'network' || problem === 'unknown') && (
          <>
            <div className="alert alert--warn" role="alert" style={{ width: '100%' }} data-testid="upload-unknown">
              {problem === 'network' ? t('Связь с сервером прервалась.') : t('Сервер не ответил вовремя.')}{' '}{t('Письмо могло успеть сохраниться. Сначала проверьте входящие в кабинете, чтобы не загрузить его дважды.')}
            </div>
            <Link to="/app" className="btn btn--primary btn--small">
              {t('Проверить входящие')}
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
  REPLY: t('ответить'),
  DOCUMENTS: t('прислать документы'),
  OBJECTION: t('возражение'),
  FOLLOW_UP: t('напоминание'),
};

/** Состояние факта по данным сервера. Локальная отметка «Верно» статус не меняет. */
function ClaimStatusChip({ claim }: { claim: LetterClaim }) {
  if (claim.status === 'CONFIRMED') return <span className="status status--done">{t('Подтверждено')}</span>;
  if (claim.status === 'REJECTED') return <span className="status status--overdue">{t('Отклонено')}</span>;
  if (claim.basis === 'USER') return <span className="status status--check">{t('Исправлено вами')}</span>;
  return <span className="status status--check">{t('Нужно проверить')}</span>;
}

/** Даты с точками или запятыми → ГГГГ-ММ-ДД, сумма с запятой → с точкой. */
export function parseUserValue(kind: LetterClaim['kind'], raw: string): { value: string } | { error: string } {
  const v = raw.trim();
  if (!v) return { error: t('Введите значение') };
  if (kind === 'DEADLINE' || kind === 'LETTER_DATE') {
    const m = /^(\d{1,2})[.,](\d{1,2})[.,](\d{4})$/.exec(v);
    if (!m) return { error: t('Дата в формате ТТ.ММ.ГГГГ') };
    const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(Date.UTC(y, mo - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return { error: t('Такой даты нет') };
    return { value: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
  }
  if (kind === 'AMOUNT') {
    const n = v.replace(/\s|€|EUR/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(n)) return { error: t('Сумма числом, например 120,50') };
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
        <label htmlFor={id}>{isDate ? t('Верная дата (ТТ.ММ.ГГГГ)') : t('Верное значение')}</label>
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
          {t('Сохранить исправление')}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => onDone(null)}>
          {t('Отмена')}
        </button>
      </div>
    </form>
  );
}

/**
 * E01 (#163): подсказка дела по номеру. Номера зашифрованных дел сервер не видит, поэтому браузер
 * сравнивает номер письма с уже расшифрованным списком дел и добавляет найденное к подсказкам сервера.
 */
function useCaseSuggestions(letter: LetterDetail | undefined, fromServer: CaseSuggestion[] = []): CaseSuggestion[] {
  const cases = useCasesQuery();
  return useMemo(() => {
    const number = letter?.claims.find((c) => c.kind === 'CASE_NUMBER' && c.status !== 'REJECTED')?.value;
    if (!number) return fromServer;
    const norm = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const found = (cases.data ?? [])
      .filter((c) => c.caseNumber && norm(c.caseNumber) === norm(number))
      .filter((c) => !fromServer.some((s) => s.caseId === c.id))
      .map((c) => ({ caseId: c.id, title: c.title, reason: t('Совпадает номер дела {v0}', { v0: number }) }));
    return [...fromServer, ...found].slice(0, 3);
  }, [letter, fromServer, cases.data]);
}

/** Шаг 3: проверка фактов письма. Решения до «Сохранить проверку» живут только на этой странице. */
export function LetterCheckPage({ id }: { id: string }) {
  const q = useLetterQuery(id);
  const location = useLocation();
  const navigate = useNavigate();
  const fromUpload = (location.state ?? null) as { dropped?: number; suggestions?: CaseSuggestion[] } | null;
  const suggestions = useCaseSuggestions(q.data, fromUpload?.suggestions);
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
  // Уход нажат, пока шло сохранение: когда оно закончилось и несохранённого не осталось, спрашивать нечего.
  useEffect(() => {
    if (blocker.state === 'blocked' && pending === 0) blocker.proceed();
  }, [blocker, pending]);

  // Решения только для фактов, которые сервер ещё считает непроверенными.
  useEffect(() => {
    if (!q.data) return;
    const open = new Set(q.data.claims.filter((c) => c.status === 'UNCONFIRMED').map((c) => c.id));
    setDecisions((d) => {
      const kept = Object.fromEntries(Object.entries(d).filter(([cid]) => open.has(cid)));
      return Object.keys(kept).length === Object.keys(d).length ? d : kept;
    });
  }, [q.data]);

  if (q.isLoading) return <Loading text={t('Загружаем письмо…')} />;
  if (q.error || !q.data) {
    const notFound = errorCode(q.error) === 'NOT_FOUND';
    return (
      <>
        <PageHeader title={notFound ? t('Письмо не найдено') : t('Не получилось открыть письмо')} back="/app" />
        {!notFound && <ErrorAlert error={q.error} />}
        <Link to="/app" className="btn btn--secondary">
          {t('В кабинет')}
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
      setNotice({ tone: 'info', text: t('Проверка сохранена.') });
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
    setNotice({ tone: 'info', text: t('Исправление сохранено. Подтвердите новое значение.') });
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
      <PageHeader title={t('Проверьте факты')} subtitle={t('Сравните с письмом. Ja!sno показывает только то, что нашло дословно в тексте.')} back="/app" />
      <Steps n={3} />
      <LetterOriginals letterId={letter.id} files={letter.files} />

      {blocker.state === 'blocked' && (
        <div className="alert alert--warn stack-s" role="alertdialog" aria-label={t('Несохранённые решения')}>
          <span>{t('Есть несохранённые решения (')}{pending}{t('). Уйти без сохранения?')}</span>
          <div className="row wrap">
            <button type="button" className="btn btn--secondary btn--small" onClick={() => blocker.reset()}>
              {t('Остаться')}
            </button>
            <button type="button" className="btn btn--ghost btn--small" onClick={() => blocker.proceed()}>
              {t('Уйти без сохранения')}
            </button>
          </div>
        </div>
      )}

      {conflict && (
        <div className="alert alert--error stack-s" role="alert" data-testid="conflict">
          <span>{t('Факты изменились в другом окне или уже сохранены. Ничего не записано.')}</span>
          <button
            type="button"
            className="btn btn--secondary btn--small"
            onClick={() => {
              setConflict(false);
              void q.refetch();
            }}
          >
            {t('Перечитать данные')}
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
          <h2 style={{ fontSize: 19 }}>{t('Факты не найдены')}</h2>
          <p className="text-2">
            {t('Ja!sno прочитало письмо, но не нашло в тексте ведомство, номер дела, даты или требования с цитатой. Это не ошибка: посмотрите текст письма ниже или в оригинале.')}
          </p>
        </section>
      ) : (
        <ul className="list-reset stack" aria-label={t('Факты письма')}>
          {claims.map((c) => {
            const d = decisions[c.id];
            return (
              <li key={c.id} className="card stack-s" data-testid="claim">
                <div className="row-between">
                  <span className="small text-2">{CLAIM_KIND[c.kind] ?? c.kind}</span>
                  <ClaimStatusChip claim={c} />
                </div>
                <strong>{tMsg(c.text)}</strong>
                {c.relativeDeadline && <span className="small">{t('Точную дату нужно уточнить: она зависит от дня получения письма.')}</span>}
                {c.quote ? (
                  <blockquote className="small text-2" style={{ margin: 0 }}>
                    «{c.quote}»{c.page ? t(' · стр. {v0}', { v0: c.page }) : ''}
                  </blockquote>
                ) : c.basis === 'USER' ? (
                  <span className="small text-2">{t('Указано вами, цитаты из письма нет.')}</span>
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
                          <Icon name="check" size={16} />{' '}{t('Верно')}
                        </button>
                        <button
                          type="button"
                          className={`btn btn--small ${d === 'wrong' ? 'btn--navy' : 'btn--secondary'}`}
                          aria-pressed={d === 'wrong'}
                          onClick={() => decide(c.id, 'wrong')}
                        >
                          {t('Неверно')}
                        </button>
                      </>
                    )}
                    <button type="button" className="btn btn--ghost btn--small" onClick={() => setEditing(c.id)}>
                      {t('Исправить')}
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
          {t('Ещё')}{' '}{dropped} {dropped === 1 ? t('значение не прошло') : t('значения не прошли')}{' '}{t('проверку: их не было дословно в тексте письма, поэтому Ja!sno их не показывает.')}
        </div>
      )}

      {deadlines.length > 0 && (
        <section className="stack-s" aria-label={t('Сроки')}>
          <h2 style={{ fontSize: 19 }}>{t('Сроки')}</h2>
          {deadlines.map((dl) => (
            <div key={dl.id} className="card row-between" data-testid="deadline">
              <span>
                {t('до')}{' '}{formatDate(dl.date)} · {DEADLINE_KIND[dl.kind] ?? dl.kind}
              </span>
              {dl.active ? (
                <span className="status status--action">{t('Действует')}</span>
              ) : (
                <span className="status status--check">{t('Кандидат: подтвердите срок')}</span>
              )}
            </div>
          ))}
        </section>
      )}

      {claims.length > 0 && (
        <button type="button" className="btn btn--primary" disabled={pending === 0 || saving.isLoading} onClick={() => void save()}>
          {saving.isLoading ? t('Сохраняем…') : `${t('Сохранить проверку')}${pending ? ` (${pending})` : ''}`}
        </button>
      )}

      <details className="card">
        <summary>{t('Текст письма')}</summary>
        <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
          {letter.text}
        </pre>
      </details>

      <section className="card stack-s" aria-label={t('Что дальше')}>
        <h2 style={{ fontSize: 19 }}>{t('Что дальше')}</h2>
        {suggestions.map((s) => (
          <span key={s.caseId} className="small text-2">
            {t('Похоже на дело «')}{s.title}»: {s.reason}.
          </span>
        ))}
        <AssignBlock
          letterId={id}
          suggestedTitle={q.data?.letter.title ?? null}
          suggestions={suggestions}
          pending={pending}
          onSave={save}
          onDiscard={() => setDecisions({})}
          onError={(text) => setNotice({ tone: 'error', text })}
        />
        <button type="button" className="btn btn--secondary btn--small" onClick={() => navigate('/app')}>
          {t('Оставить во входящих')}
        </button>
        {!askDelete ? (
          <button type="button" className="btn btn--danger btn--small" onClick={() => setAskDelete(true)}>
            <Icon name="trash" size={16} />{' '}{t('Удалить письмо')}
          </button>
        ) : (
          <div className="alert alert--error stack-s" role="alertdialog" aria-label={t('Удалить письмо')}>
            <span>{t('Удалить письмо, его факты и файл безвозвратно?')}</span>
            <div className="row wrap">
              <button type="button" className="btn btn--danger btn--small" disabled={deleting.isLoading} onClick={remove}>
                {t('Удалить безвозвратно')}
              </button>
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setAskDelete(false)}>
                {t('Отмена')}
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
  suggestedTitle,
  suggestions,
  pending,
  onSave,
  onDiscard,
  onError,
}: {
  letterId: string;
  /** Поправка 8: название письма от Ja!sno, им заполняется название нового дела */
  suggestedTitle: string | null;
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
  const [title, setTitle] = useState(suggestedTitle ?? '');
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
      <legend className="small text-2">{t('Положить письмо в дело')}</legend>
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
        <span>{t('Новое дело')}</span>
      </label>
      {choice === 'new' && (
        <div className="field">
          <label htmlFor="new-case-title">{t('Название дела (можно изменить)')}</label>
          <input
            id="new-case-title"
            className="input"
            value={title}
            maxLength={120}
            placeholder={t('Из подтверждённых фактов или «Новое дело»')}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
      )}
      {askPending && pending > 0 ? (
        <div className="alert alert--warn stack-s" role="alertdialog" aria-label={t('Несохранённые решения перед делом')}>
          <span>{t('Есть несохранённые решения (')}{pending}{t('). Сохранить их перед тем, как положить письмо в дело?')}</span>
          <div className="row wrap">
            <button
              type="button"
              className="btn btn--primary btn--small"
              disabled={assigning.isLoading}
              onClick={async () => {
                if (await onSave()) await assign();
              }}
            >
              {t('Сохранить и положить')}
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--small"
              onClick={() => {
                onDiscard();
                setAskPending(false);
              }}
            >
              {t('Отменить решения')}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--primary btn--small" disabled={assigning.isLoading} onClick={() => void start()}>
          {t('В дело')}
        </button>
      )}
    </fieldset>
  );
}
