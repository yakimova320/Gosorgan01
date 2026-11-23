import { useMemo, useState } from 'react';
import { errorCode } from '../../api/errors';
import { Link } from 'react-router';
import { useCabinetQuery, useCasesQuery, useLettersQuery, type InboxLetter } from '../../store/api';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { CaseRow, ErrorAlert, Loading, NextStepCard, PageHeader } from '../../components/ui';
import { formatDate } from '../../lib/dates';

function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false }).format(new Date()));
  if (h < 11) return 'Доброе утро';
  if (h < 18) return 'Добрый день';
  return 'Добрый вечер';
}

export function CabinetPage() {
  const cabinet = useCabinetQuery();
  const cases = useCasesQuery();
  const letters = useLettersQuery();

  if (cabinet.isLoading || cases.isLoading || letters.isLoading) return <Loading />;
  const name = cabinet.data?.profile?.firstName;
  const list = cases.data ?? [];
  const inbox = letters.data ?? [];
  // Дела подключаются в B07: до этого «не подключено» значит «дел нет», а не ошибка.
  const casesError = errorCode(cases.error) === 'NOT_CONNECTED' ? null : cases.error;

  if (!casesError && !letters.error && list.length === 0 && inbox.length === 0) {
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
      <ErrorAlert error={cabinet.error ?? casesError ?? letters.error} />

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

      {inbox.length > 0 && <InboxList letters={inbox} />}

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

/** Входящие письма (без дела). Проверка фактов на сайте подключается в F02. */
function InboxList({ letters }: { letters: InboxLetter[] }) {
  return (
    <section className="stack" aria-labelledby="inbox-title">
      <h2 id="inbox-title" style={{ fontSize: 19 }}>
        Входящие письма
      </h2>
      {letters.map((l) => (
        <Link key={l.id} to={`/app/letters/${l.id}/check`} className="card row-between" data-testid="inbox-letter">
          <div className="stack-s">
            <strong>{l.title || l.authority || 'Письмо'}</strong>
            <span className="small text-2">
              {l.title && l.authority ? `${l.authority} · ` : ''}
              {formatDate(l.createdAt.slice(0, 10))}
              {l.caseNumber ? ` · ${l.caseNumber}` : ''}
            </span>
          </div>
          {l.unconfirmed > 0 && <span className="status status--check">Проверить фактов: {l.unconfirmed}</span>}
        </Link>
      ))}
    </section>
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
