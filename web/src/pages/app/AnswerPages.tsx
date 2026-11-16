import { useState } from 'react';
import { api } from '../../api';
import { errorCode } from '../../api/errors';
import type { Draft, DraftKind } from '../../api/types';
import { useFlow } from '../../app/flow';
import { Link, useRouter } from '../../app/router';
import { useSession } from '../../app/session';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { DemoNote, ErrorAlert, Loading, PageHeader } from '../../components/ui';
import { DRAFT_KIND } from '../../lib/labels';
import { useAsync } from '../../lib/useAsync';

/** Шаг 1: цель ответа. */
export function AnswerGoalPage({ caseId }: { caseId: string }) {
  const { answer, setAnswer } = useFlow();
  const { navigate } = useRouter();

  return (
    <>
      <PageHeader title="Что вы хотите ответить?" back={`/app/cases/${caseId}`} />
      <ul className="list-reset stack">
        {(Object.keys(DRAFT_KIND) as DraftKind[]).map((k) => {
          const d = DRAFT_KIND[k];
          return (
            <li key={k}>
              <button
                type="button"
                className="card row"
                disabled={!d.ready}
                style={{ width: '100%', textAlign: 'left', border: 0, cursor: d.ready ? 'pointer' : 'not-allowed', opacity: d.ready ? 1 : 0.6, outline: answer.kind === k ? '2px solid var(--c-teal)' : undefined }}
                onClick={() => {
                  setAnswer({ ...answer, kind: k });
                  navigate(`/app/cases/${caseId}/answer/details`);
                }}
              >
                <div className="stack-s" style={{ flex: 1 }}>
                  <span style={{ fontWeight: 700 }}>{d.title}</span>
                  <span className="muted">{d.ready ? d.text : `${d.text}. Появится к 03.12`}</span>
                </div>
                <Icon name="arrowRight" size={18} />
              </button>
            </li>
          );
        })}
      </ul>
      <Link to="/beratung" className="card row">
        <Icon name="people" color="var(--c-teal)" />
        <div className="stack-s" style={{ flex: 1 }}>
          <span style={{ fontWeight: 700 }}>Не согласен(на) с решением</span>
          <span className="muted">Widerspruch Ja!sno не пишет. Покажем, где получить консультацию</span>
        </div>
        <Icon name="arrowRight" size={18} />
      </Link>
    </>
  );
}

const QUESTIONS = ['Какие именно документы нужны?', 'Можно ли прислать копии вместо оригиналов?', 'Можно ли отправить документы по e-mail?'];

/** Шаг 2: что именно непонятно (для запроса уточнения). */
export function AnswerDetailsPage({ caseId }: { caseId: string }) {
  const { answer, setAnswer } = useFlow();
  const { navigate } = useRouter();
  const [q, setQ] = useState(answer.question);

  return (
    <>
      <PageHeader title="Что именно непонятно?" subtitle="Ваш вопрос попадёт в письмо как вопрос, а не как факт." back={`/app/cases/${caseId}/answer`} />
      <div className="stack">
        {QUESTIONS.map((x) => (
          <button key={x} type="button" className="tab" style={{ alignSelf: 'flex-start', minHeight: 44 }} aria-pressed={q === x} onClick={() => setQ(x)}>
            {x}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="q">Свой вопрос по-русски</label>
        <textarea id="q" className="textarea" value={q} onChange={(e) => setQ(e.target.value)} maxLength={300} />
        <span className="muted">Перевод вопроса на немецкий подключается вместе с черновиком (B10).</span>
      </div>
      <button
        type="button"
        className="btn btn--primary"
        disabled={!q.trim()}
        onClick={() => {
          setAnswer({ ...answer, question: q.trim() });
          navigate(`/app/cases/${caseId}/answer/draft`);
        }}
      >
        Собрать черновик
      </button>
    </>
  );
}

function DraftText({ draft }: { draft: Draft }) {
  const [tab, setTab] = useState<'de' | 'ru'>('de');
  return (
    <div className="stack">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === 'de'} onClick={() => setTab('de')}>
          Немецкий (отправлять)
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'ru'} onClick={() => setTab('ru')}>
          Перевод на русский
        </button>
      </div>
      <pre className="card" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.55 }}>
        {tab === 'de' ? draft.germanText : draft.russianText}
      </pre>
    </div>
  );
}

/** Шаг 3: проверка черновика. */
export function AnswerDraftPage({ caseId }: { caseId: string }) {
  const { token } = useSession();
  const { answer } = useFlow();
  const d = useAsync(() => api.draft(token, caseId, answer.kind, answer.question), [token, caseId, answer.kind, answer.question]);
  const [copied, setCopied] = useState(false);

  if (d.loading) return <Loading text="Собираем черновик из подтверждённых фактов…" />;
  if (d.error) {
    return (
      <>
        <PageHeader title="Черновик ответа" back={`/app/cases/${caseId}`} />
        <ErrorAlert error={d.error} />
        {errorCode(d.error) === 'NO_CONFIRMED_CLAIMS' && (
          <Link to={`/app/cases/${caseId}`} className="btn btn--secondary">
            К фактам дела
          </Link>
        )}
      </>
    );
  }
  const draft = d.data!;

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.germanText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <PageHeader title="Черновик ответа" back={`/app/cases/${caseId}/answer/details`} />
      {draft.stale && <div className="alert alert--warn">Факты изменились после сборки. Соберите черновик заново.</div>}
      <div className="desktop-2col stack">
        <DraftText draft={draft} />
        <section className="stack">
          <div className={`alert ${draft.verification.passed ? 'alert--info' : 'alert--error'}`}>
            {draft.verification.passed ? 'Проверка пройдена: даты и номера взяты из подтверждённых фактов.' : 'Черновик не прошёл проверку.'}
          </div>
          <div className="card stack-s">
            <span className="eyebrow">На чём основан черновик</span>
            {draft.verification.checklist.map((c) => (
              <div key={c.claimId} className="stack-s" style={{ gap: 4 }}>
                <span style={{ fontWeight: 600 }}>{c.text}</span>
                {c.quote && <blockquote className="quote">{c.quote}</blockquote>}
              </div>
            ))}
          </div>
          <p className="muted">Перед отправкой проверьте имя, адрес, номер дела и поставьте подпись. Отвечаете за текст вы.</p>
          <button type="button" className="btn btn--primary" onClick={copy}>
            <Icon name="copy" size={18} color="#FFFFFF" /> {copied ? 'Скопировано' : 'Скопировать немецкий текст'}
          </button>
          <DemoNote>Правка текста на сайте появится к 03.12</DemoNote>
          <Link to={`/app/cases/${caseId}/answer/send`} className="btn btn--secondary">
            Как отправить
          </Link>
        </section>
      </div>
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
