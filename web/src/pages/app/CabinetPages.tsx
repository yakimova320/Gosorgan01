import { useMemo, useState } from 'react';
import { errorCode } from '../../api/errors';
import type { CaseStage, Claim, Letter } from '../../api/types';
import { Link } from 'react-router';
import { skipToken } from '@reduxjs/toolkit/query/react';
import { useCabinetQuery, useCaseDetailQuery, useCasesQuery, useExplainQuery, useHistoryQuery } from '../../store/api';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { CaseRow, DemoNote, ErrorAlert, Loading, NextStepCard, PageHeader, StageChip } from '../../components/ui';
import { deadlineText, formatDate, formatDateTime } from '../../lib/dates';
import { CLAIM_KIND } from '../../lib/labels';

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false }).format(new Date()));
  if (h < 11) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export function CabinetPage() {
  const cabinet = useCabinetQuery();
  const cases = useCasesQuery();

  if (cabinet.isLoading || cases.isLoading) return <Loading />;
  const name = cabinet.data?.profile?.firstName;
  const list = cases.data ?? [];

  if (!cases.error && list.length === 0) {
    return (
      <>
        <PageHeader title={name ? `${greeting()}, ${name}` : greeting()} />
        <section className="card stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <Illustration name="mailbox" height={180} blob="#FCEFC9" />
          <h2>Здесь пока тихо</h2>
          <p className="text-2">Пришло письмо из ведомства? Сфотографируйте его, и Ja!sno объяснит, что в нём.</p>
          <Link to="/app/scan" className="btn btn--primary">
            <Icon name="scan" size={20} color="#FFFFFF" width={2.2} /> Сфотографировать письмо
          </Link>
        </section>
      </>
    );
  }

  const active = list.filter((c) => c.stage !== 'CLOSED');
  const needAction = list.filter((c) => ['OVERDUE', 'DOCUMENTS', 'REPLY', 'NEEDS_CHECK'].includes(c.stage)).length;
  const next = cabinet.data?.nextDeadline;

  return (
    <>
      <div className="stack-s">
        <span className="muted">{greeting()},</span>
        <h1>{name ?? 'ваш кабинет'}</h1>
      </div>
      <ErrorAlert error={cabinet.error ?? cases.error} />

      <div className="desktop-2col stack">
        <section className="card card--teal row" style={{ borderRadius: 26, padding: '16px 0 0 18px', alignItems: 'flex-end', overflow: 'hidden', minHeight: 150 }}>
          <div className="stack-s" style={{ flex: 1, alignSelf: 'center', paddingBottom: 14 }}>
            <h3 style={{ fontSize: 20 }}>{needAction === 0 ? 'Всё под контролем' : 'Почти всё под контролем'}</h3>
            <span className="small" style={{ color: '#2F4A52' }}>
              Дел: {active.length}. {needAction > 0 ? `Нужно сделать: ${needAction}.` : 'Сейчас ничего делать не нужно.'}
            </span>
          </div>
          <div style={{ width: 140, flex: '0 0 140px', marginBottom: -20 }}>
            <Illustration name="relief" height={150} blob="#BFE0DB" flip />
          </div>
        </section>
        {next && <NextStepCard to={`/app/cases/${next.caseId}`} date={next.date} title={next.title} />}
      </div>

      <div className="row-between" style={{ paddingTop: 4 }}>
        <h2 style={{ fontSize: 19 }}>Мои дела</h2>
        <Link to="/app/history" className="link">
          Вся история
        </Link>
      </div>
      <div className="stack">
        {list.map((c, i) => (
          <CaseRow key={c.id} c={c} index={i} />
        ))}
      </div>
    </>
  );
}

const FILTERS: { id: 'active' | 'done' | 'all'; label: string }[] = [
  { id: 'active', label: 'Активные' },
  { id: 'done', label: 'Завершённые' },
  { id: 'all', label: 'Все' },
];

export function CasesPage() {
  const cases = useCasesQuery();
  const [filter, setFilter] = useState<'active' | 'done' | 'all'>('active');
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const query = q.trim().toLowerCase();
    return (cases.data ?? [])
      .filter((c) => (filter === 'all' ? true : filter === 'done' ? c.stage === 'CLOSED' : c.stage !== 'CLOSED'))
      .filter((c) => !query || [c.title, c.authority ?? '', c.caseNumber ?? ''].join(' ').toLowerCase().includes(query));
  }, [cases.data, filter, q]);

  return (
    <>
      <PageHeader title="Мои дела" />
      <input className="input" type="search" placeholder="Поиск: ведомство, номер дела" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по делам" />
      <div className="tabs" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" role="tab" className="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {cases.isLoading && <Loading />}
      <ErrorAlert error={cases.error} />
      <div className="stack">
        {shown.map((c, i) => (
          <CaseRow key={c.id} c={c} index={i} />
        ))}
        {!cases.isLoading && shown.length === 0 && <p className="muted">Дел не найдено.</p>}
      </div>
    </>
  );
}

const STAGE_HINT: Partial<Record<CaseStage, string>> = {
  OVERDUE: 'Срок прошёл. Ответьте как можно скорее или обратитесь в консультацию.',
  DOCUMENTS: 'Ведомство ждёт от вас документы.',
  REPLY: 'Ведомство ждёт ваш ответ.',
  NEEDS_CHECK: 'Проверьте факты письма: черновик собирается только из подтверждённых.',
  WAITING: 'Вы ответили. Теперь ход за ведомством.',
};

export function CasePage({ id }: { id: string }) {
  const c = useCaseDetailQuery(id);
  if (c.isLoading) return <Loading />;
  if (c.error || !c.data) return <ErrorAlert error={c.error} />;
  const cs = c.data;
  const open = cs.deadlines.filter((d) => !d.doneAt).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <PageHeader title={cs.title} back="/app/cases" />
      <div className="row wrap">
        <StageChip stage={cs.stage} />
        <span className="muted">
          {cs.authority} · {cs.caseNumber ?? 'номер дела не найден'}
        </span>
      </div>
      {STAGE_HINT[cs.stage] && <div className="alert alert--info">{STAGE_HINT[cs.stage]}</div>}

      <div className="desktop-2col stack">
        <section className="stack">
          {open.length > 0 && (
            <div className="card stack-s">
              <span className="eyebrow">Сроки</span>
              {open.map((d) => (
                <div key={d.id} className="row-between">
                  <span style={{ fontWeight: 700 }}>до {formatDate(d.date)}</span>
                  <span className="muted">{deadlineText(d.date)}</span>
                </div>
              ))}
              <DemoNote>«В календарь» появится к 03.12</DemoNote>
            </div>
          )}

          <div className="stack">
            <h2 style={{ fontSize: 19 }}>Письма</h2>
            {cs.letters.map((l) => (
              <Link key={l.id} to={`/app/letters/${l.id}?case=${cs.id}`} className="card row">
                <Icon name="doc" color="var(--c-teal)" />
                <div className="stack-s" style={{ flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>Письмо от {formatDate(l.claims.find((x) => x.kind === 'LETTER_DATE')?.value ?? l.createdAt)}</span>
                  <span className="muted">{l.explanation ? 'Объяснение готово' : 'Открыть объяснение'}</span>
                </div>
                <Icon name="arrowRight" size={18} />
              </Link>
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
            {cs.timeline.map((t, i) => (
              <li key={i} className="card stack-s" style={{ padding: 14 }}>
                <span style={{ fontWeight: 600 }}>{t.title}</span>
                <span className="muted">
                  {formatDateTime(t.at)}
                  {t.subtitle ? ` · ${t.subtitle}` : ''}
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn--danger btn--small" style={{ alignSelf: 'flex-start' }} disabled title="Появится вместе с API дел (B07)">
            <Icon name="trash" size={16} /> Удалить дело
          </button>
          <DemoNote>Удаление дела подключается в задаче B07</DemoNote>
        </section>
      </div>
    </>
  );
}

function FactRow({ claim }: { claim: Claim }) {
  const ok = claim.status === 'CONFIRMED';
  return (
    <li className="card stack-s" style={{ padding: 14 }}>
      <div className="row-between">
        <span className="eyebrow" style={{ color: 'var(--c-text-3)' }}>
          {CLAIM_KIND[claim.kind]}
        </span>
        <span className={`status ${ok ? 'status--done' : 'status--check'}`}>{ok ? 'Подтверждено' : 'Не проверено'}</span>
      </div>
      <span style={{ fontWeight: 600 }}>{claim.text}</span>
      {claim.quote && <blockquote className="quote">{claim.quote}</blockquote>}
    </li>
  );
}

export function LetterPage({ id, caseId }: { id: string; caseId: string | null }) {
  const cs = useCaseDetailQuery(caseId ?? skipToken);
  const letter: Letter | undefined = cs.data?.letters.find((l) => l.id === id);
  const expl = useExplainQuery(id);
  const [showOriginal, setShowOriginal] = useState(false);

  if (cs.isLoading) return <Loading />;
  if (!letter) return <ErrorAlert error={cs.error ?? new Error('not found')} />;
  const datesFailed = errorCode(expl.error) === 'DATES_NOT_VERIFIED';

  return (
    <>
      <PageHeader title="Письмо без паники" back={caseId ? `/app/cases/${caseId}` : '/app'} />
      <div className="desktop-2col stack">
        <section className="stack">
          {expl.isLoading && <Loading text="Ja!sno объясняет письмо…" />}
          {expl.data && (
            <>
              <div className="card card--teal stack">
                <span className="eyebrow">О чём письмо</span>
                <p style={{ fontSize: 16 }}>{expl.data.about}</p>
              </div>
              <div className="card stack">
                <span className="eyebrow">Что сделать</span>
                <ol style={{ margin: 0, paddingLeft: 20 }} className="stack-s">
                  {expl.data.actions.map((a) => (
                    <li key={a.text}>{a.text}</li>
                  ))}
                </ol>
              </div>
              {expl.data.deadline && (
                <div className="card card--navy stack-s">
                  <span className="eyebrow" style={{ color: '#FF9F7E' }}>
                    До какого числа
                  </span>
                  <span style={{ fontFamily: 'var(--font-head)', fontSize: 24, fontWeight: 800 }}>{formatDate(expl.data.deadline.date)}</span>
                  <span style={{ color: 'var(--c-on-navy-2)' }}>{deadlineText(expl.data.deadline.date)}. Перепроверьте срок по оригиналу письма.</span>
                </div>
              )}
              {expl.data.unconfirmed && <div className="alert alert--warn">В объяснении есть факты, которые вы ещё не подтвердили.</div>}
            </>
          )}
          {datesFailed && (
            <div className="alert alert--warn" role="alert">
              Не удалось надёжно объяснить сроки. Посмотрите срок в оригинале письма. Ниже факты с цитатами.
            </div>
          )}
          {!!expl.error && !datesFailed && <ErrorAlert error={expl.error} />}
          <div className="row wrap">
            {caseId && (
              <Link to={`/app/cases/${caseId}/answer`} className="btn btn--primary">
                Подготовить ответ
              </Link>
            )}
            <Link to="/app/ask" className="btn btn--secondary">
              <Icon name="chat" size={18} /> Спросить
            </Link>
          </div>
        </section>

        <section className="stack">
          <h2 style={{ fontSize: 19 }}>Факты с цитатами</h2>
          <ul className="list-reset stack">
            {letter.claims.map((c) => (
              <FactRow key={c.id} claim={c} />
            ))}
          </ul>
          <button type="button" className="btn btn--secondary btn--small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowOriginal((v) => !v)} aria-expanded={showOriginal}>
            {showOriginal ? 'Скрыть оригинал' : 'Показать оригинал письма'}
          </button>
          {showOriginal && (
            <pre className="card" style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.5, margin: 0, fontFamily: 'ui-serif, Georgia, serif' }}>
              {letter.rawText}
            </pre>
          )}
        </section>
      </div>
    </>
  );
}

export function HistoryPage() {
  const h = useHistoryQuery();
  const [q, setQ] = useState('');
  const items = (h.data ?? []).filter((i) => !q || `${i.title} ${i.subtitle ?? ''} ${i.caseTitle}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="История" subtitle="Все письма, вопросы и ответы по всем делам." />
      <input className="input" type="search" placeholder="Поиск по истории" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по истории" />
      {h.isLoading && <Loading />}
      <ErrorAlert error={h.error} />
      <ol className="list-reset stack">
        {items.map((i, n) => (
          <li key={n}>
            <Link to={i.letterId ? `/app/letters/${i.letterId}?case=${i.caseId}` : `/app/cases/${i.caseId}`} className="card stack-s" style={{ padding: 14 }}>
              <span style={{ fontWeight: 600 }}>{i.title}</span>
              <span className="muted">
                {i.caseTitle} · {formatDateTime(i.at)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}
