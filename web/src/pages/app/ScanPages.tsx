import { useEffect, useRef, useState } from 'react';
import { errorText } from '../../api/errors';
import { useFlow } from '../../app/flow';
import { Link, Navigate, useNavigate } from 'react-router';
import { useUploadLetterMutation } from '../../store/api';
import { putUploadFiles } from '../../store/uploads';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { DemoNote, ErrorAlert, PageHeader } from '../../components/ui';
import { CLAIM_KIND } from '../../lib/labels';

const MAX_FILES = 10;
const MAX_FILE_MB = 10;
const MAX_LETTER_MB = 20;
const ACCEPT = 'image/jpeg,image/png,application/pdf';

function Steps({ n }: { n: 1 | 2 | 3 | 4 | 5 }) {
  const labels = ['Снимок', 'Страницы', 'Чтение', 'Факты', 'Дело'];
  return (
    <ol className="list-reset row" aria-label={`Шаг ${n} из 5`} style={{ gap: 6 }}>
      {labels.map((l, i) => (
        <li key={l} style={{ flex: 1 }}>
          <span style={{ display: 'block', height: 5, borderRadius: 3, background: i < n ? 'var(--c-orange)' : 'var(--c-track)' }} />
          <span className="visually-hidden">{l}</span>
        </li>
      ))}
    </ol>
  );
}

/** Шаг 1: снимок или файл. */
export function ScanStartPage() {
  const { pages, addFiles } = useFlow();
  const navigate = useNavigate();
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  function take(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const tooBig = list.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) return setProblem(`Файл «${tooBig.name}» больше ${MAX_FILE_MB} МБ.`);
    if (pages.length + list.length > MAX_FILES) return setProblem(`На одно письмо можно до ${MAX_FILES} фото.`);
    setProblem(null);
    addFiles(list);
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
      <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={(e) => take(e.target.files)} />
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
      <p className="muted">
        JPG, PNG или PDF. Файл до {MAX_FILE_MB} МБ, все страницы письма вместе до {MAX_LETTER_MB} МБ.
      </p>
    </>
  );
}

/** Шаг 2: проверка страниц. */
export function ScanPagesPage() {
  const { pages, removePage, movePage } = useFlow();
  const navigate = useNavigate();
  const total = pages.reduce((s, p) => s + p.file.size, 0);
  const tooBig = total > MAX_LETTER_MB * 1024 * 1024;

  if (pages.length === 0) return <Navigate to="/app/scan" replace />;

  return (
    <>
      <PageHeader title="Проверьте страницы" back="/app/scan" />
      <Steps n={2} />
      <p className="text-2 small">Страницы идут в том порядке, в каком их прочитает Ja!sno. Текст на снимке должен читаться.</p>
      <div className="thumbs">
        {pages.map((p, i) => (
          <div key={p.url} className="stack-s">
            <div className="thumb">
              {p.file.type === 'application/pdf' ? <Icon name="doc" size={40} color="var(--c-teal)" /> : <img src={p.url} alt={`Страница ${i + 1}`} />}
              <span className="thumb-n">{i + 1}</span>
            </div>
            <div className="row" style={{ gap: 4, justifyContent: 'center' }}>
              <button type="button" className="btn btn--ghost btn--small" aria-label={`Страницу ${i + 1} раньше`} disabled={i === 0} onClick={() => movePage(i, -1)}>
                ←
              </button>
              <button type="button" className="btn btn--ghost btn--small" aria-label={`Удалить страницу ${i + 1}`} onClick={() => removePage(i)}>
                <Icon name="trash" size={16} />
              </button>
              <button type="button" className="btn btn--ghost btn--small" aria-label={`Страницу ${i + 1} позже`} disabled={i === pages.length - 1} onClick={() => movePage(i, 1)}>
                →
              </button>
            </div>
          </div>
        ))}
      </div>
      {pages.length > 1 && <div className="alert alert--info">Письмо из нескольких фото сервер начнёт принимать к 03.12 (задача B11).</div>}
      {tooBig && <div className="alert alert--error">Все страницы вместе больше {MAX_LETTER_MB} МБ.</div>}
      <Link to="/app/scan" className="btn btn--secondary">
        <Icon name="plus" size={18} /> Добавить страницу
      </Link>
      <button type="button" className="btn btn--primary" disabled={tooBig} onClick={() => navigate('/app/scan/reading')}>
        Готово, читать письмо
      </button>
    </>
  );
}

/** Шаг 3: Ja!sno читает. Показываем только реальное состояние запроса, без придуманных галочек. */
export function ScanReadingPage() {
  const [uploadLetter] = useUploadLetterMutation();
  const { pages, setUpload } = useFlow();
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(-1);

  useEffect(() => {
    if (pages.length === 0 || started.current === attempt) return;
    started.current = attempt; // защита от двойной отправки
    setError(null);
    uploadLetter(putUploadFiles(pages.map((p) => p.file)))
      .unwrap()
      .then((r) => {
        setUpload(r);
        navigate('/app/scan/facts', { replace: true });
      })
      .catch(setError);
  }, [attempt, pages, uploadLetter, setUpload, navigate]);

  if (pages.length === 0) return <Navigate to="/app/scan" replace />;

  return (
    <>
      <PageHeader title="Ja!sno читает письмо" />
      <Steps n={3} />
      <div className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <Illustration name="talk" height={180} blob="#DDEFEC" />
        {!error ? (
          <>
            <div className="spinner" role="status" aria-label="Идёт чтение" />
            <p className="text-2">Читаем текст и ищем факты с цитатами. Обычно это до минуты.</p>
          </>
        ) : (
          <>
            <div className="alert alert--error" role="alert" style={{ width: '100%' }}>
              {errorText(error)}
            </div>
            <div className="row wrap" style={{ justifyContent: 'center' }}>
              <button type="button" className="btn btn--primary btn--small" onClick={() => setAttempt((a) => a + 1)}>
                Попробовать ещё раз
              </button>
              <Link to="/app/scan" className="btn btn--secondary btn--small">
                Новое фото
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Шаг 4: проверка фактов с цитатами. */
export function ScanFactsPage() {
  const { upload, decisions, decide } = useFlow();
  const navigate = useNavigate();
  if (!upload) return <Navigate to="/app/scan" replace />;
  const claims = upload.claims;
  const checked = claims.filter((c) => decisions[c.id]).length;

  return (
    <>
      <PageHeader title="Проверьте факты" subtitle="Сравните с письмом. Черновик ответа соберётся только из того, что вы отметите «Верно»." />
      <Steps n={4} />
      <div className="row-between">
        <span className="small text-2">
          Проверено {checked} из {claims.length}
        </span>
        <div className="progress" style={{ width: 120 }}>
          <span style={{ width: `${(checked / Math.max(claims.length, 1)) * 100}%`, background: 'var(--c-teal)' }} />
        </div>
      </div>
      <ul className="list-reset stack">
        {claims.map((c) => {
          const d = decisions[c.id];
          return (
            <li key={c.id} className="card stack-s" style={{ padding: 14, outline: d === 'ok' ? '2px solid var(--c-teal)' : d === 'wrong' ? '2px solid var(--c-coral)' : undefined }}>
              <span className="eyebrow" style={{ color: 'var(--c-text-3)' }}>
                {CLAIM_KIND[c.kind]}
              </span>
              <span style={{ fontWeight: 700 }}>{c.text}</span>
              {c.quote && <blockquote className="quote">{c.quote}</blockquote>}
              <div className="row">
                <button type="button" className={`btn btn--small ${d === 'ok' ? 'btn--teal' : 'btn--secondary'}`} aria-pressed={d === 'ok'} onClick={() => decide(c.id, 'ok')}>
                  <Icon name="check" size={16} /> Верно
                </button>
                <button type="button" className={`btn btn--small ${d === 'wrong' ? 'btn--navy' : 'btn--secondary'}`} aria-pressed={d === 'wrong'} onClick={() => decide(c.id, 'wrong')}>
                  <Icon name="x" size={16} /> Неверно
                </button>
              </div>
              {d === 'wrong' && <span className="muted">Исправление факта появится в задаче B06. Пока неверный факт просто не попадёт в ответ.</span>}
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn--primary" disabled={checked < claims.length} onClick={() => navigate('/app/scan/assign')}>
        Дальше: выбрать дело
      </button>
      {checked < claims.length && <span className="muted">Отметьте все факты, чтобы продолжить.</span>}
    </>
  );
}

/** Шаг 5: в какое дело положить письмо. */
export function ScanAssignPage() {
  const { upload, resetScan } = useFlow();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<string>(upload?.suggestions[0]?.caseId ?? 'new');
  const [error] = useState<unknown>(null);
  if (!upload) return <Navigate to="/app/scan" replace />;

  function finish(target: 'case' | 'inbox' | 'delete') {
    resetScan();
    if (target === 'case') navigate(choice === 'new' ? '/app/done?what=case' : `/app/cases/${choice}`, { replace: true });
    else navigate('/app', { replace: true });
  }

  return (
    <>
      <PageHeader title="Куда положить письмо?" />
      <Steps n={5} />
      <div className="stack">
        {upload.suggestions.map((s) => (
          <label key={s.caseId} className="card row" style={{ cursor: 'pointer', outline: choice === s.caseId ? '2px solid var(--c-teal)' : undefined }}>
            <input type="radio" name="case" checked={choice === s.caseId} onChange={() => setChoice(s.caseId)} />
            <div className="stack-s">
              <span style={{ fontWeight: 700 }}>{s.title}</span>
              <span className="muted">Подходит: {s.reason}</span>
            </div>
          </label>
        ))}
        <label className="card row" style={{ cursor: 'pointer', outline: choice === 'new' ? '2px solid var(--c-teal)' : undefined }}>
          <input type="radio" name="case" checked={choice === 'new'} onChange={() => setChoice('new')} />
          <div className="stack-s">
            <span style={{ fontWeight: 700 }}>Новое дело</span>
            <span className="muted">Название соберётся из ведомства и требования, его можно поменять</span>
          </div>
        </label>
      </div>
      <ErrorAlert error={error} />
      <DemoNote>Сохранение письма подключается в задаче B07</DemoNote>
      <button type="button" className="btn btn--primary" onClick={() => finish('case')}>
        Сохранить в дело
      </button>
      <div className="row wrap">
        <button type="button" className="btn btn--secondary btn--small" onClick={() => finish('inbox')}>
          Оставить во входящих
        </button>
        <button type="button" className="btn btn--danger btn--small" onClick={() => finish('delete')}>
          <Icon name="trash" size={16} /> Удалить письмо
        </button>
      </div>
    </>
  );
}
