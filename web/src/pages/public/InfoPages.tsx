import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { PageHeader } from '../../components/ui';
import { CARDS, FAQ, FAQ_CONSULTATIONS, TOPICS, type Card, type Consultation } from '../../content';
import { formatDate } from '../../lib/dates';

export function FaqPage() {
  return (
    <>
      <PageHeader title="Частые вопросы" subtitle="Ответы команды Ja!sno. Если ответа нет, спросите в чате помощника." />
      {FAQ.map((section) => (
        <section key={section.title} className="stack">
          <h2>{section.title}</h2>
          {section.items.map((item) => (
            <details key={item.question} className="faq">
              <summary>{item.question}</summary>
              <div className="faq-body">
                {item.blocks.map((b, i) =>
                  b.kind === 'p' ? (
                    <p key={i}>{b.text}</p>
                  ) : b.kind === 'ul' ? (
                    <ul key={i}>
                      {b.items.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  ) : (
                    <ol key={i}>
                      {b.items.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ol>
                  ),
                )}
              </div>
            </details>
          ))}
        </section>
      ))}
    </>
  );
}

function CardView({ card }: { card: Card }) {
  if (card.draft) {
    return (
      <article className="card stack-s" style={{ gap: 8 }} data-testid="card-draft">
        <h3>{card.title}</h3>
        <p className="muted">Раздел готовится. Текст пишет команда.</p>
        {card.german.length > 0 && (
          <p className="small">
            <span className="muted">По-немецки: </span>
            {card.german.join(', ')}
          </p>
        )}
      </article>
    );
  }
  return (
    <article className="card stack-s" style={{ gap: 8 }}>
      <h3>{card.title}</h3>
      <p className="text-2" style={{ fontSize: 15 }}>
        {card.text}
      </p>
      {card.german.length > 0 && (
        <p className="small">
          <span className="muted">По-немецки: </span>
          {card.german.join(', ')}
        </p>
      )}
      <p className="muted" style={{ fontSize: 12 }}>
        {card.sources.length > 0 ? 'Источник: ' : ''}
        {card.sources.map((s, i) => (
          <span key={s.url}>
            {i > 0 && ', '}
            <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline' }}>
              {s.name}
            </a>
          </span>
        ))}
        {card.note && <> {card.note}</>} · проверено {formatDate(card.checkedAt)}
      </p>
    </article>
  );
}

export function WissenPage() {
  const [search] = useSearchParams();
  const [topic, setTopic] = useState<string>(search.get('topic') ?? TOPICS[0].id);
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      // Поиск и по скрытым ключевым словам (карточки, правило 6 документа «Важно знать»)
      return CARDS.filter((c) => [c.title, c.text, ...c.keywords, ...c.german].join(' ').toLowerCase().includes(q));
    }
    return CARDS.filter((c) => c.topic === topic);
  }, [topic, query]);

  return (
    <>
      <PageHeader title="Блог" subtitle="Короткие проверенные советы о жизни в Германии: что новоприбывшие часто упускают. Это не юридическая консультация." />
      <div className="field">
        <label htmlFor="w-search" className="visually-hidden">
          Поиск по советам
        </label>
        <input id="w-search" className="input" type="search" placeholder="Поиск: квартира, страховка, срок…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!query && (
        <div className="tabs" role="tablist" aria-label="Темы">
          {TOPICS.map((t) => (
            <button key={t.id} type="button" role="tab" className="tab" aria-selected={t.id === topic} onClick={() => setTopic(t.id)}>
              {t.title}
            </button>
          ))}
        </div>
      )}
      <div className="stack desktop-2col">
        {shown.map((c) => (
          <CardView key={c.id} card={c} />
        ))}
        {shown.length === 0 && <p className="muted">Ничего не нашлось. Попробуйте другое слово.</p>}
      </div>
      <p className="muted">
        Нужен разбор конкретного договора или решения?{' '}
        <Link to="/beratung" className="link">
          Где получить консультацию
        </Link>
      </p>
    </>
  );
}

/** Список консультаций (F05): названия и тексты из FAQ (content/faq.ru.md, вопрос «Куда обратиться…»), без адресов и цен. */
const CONSULTATIONS: Consultation[] = FAQ_CONSULTATIONS.places;

export function BeratungPage() {
  return (
    <>
      <PageHeader title="Найти консультацию" subtitle="Возражение (Widerspruch) и юридические вопросы Ja!sno не пишет. По закону о правовых услугах (RDG) такие советы дают юристы и уполномоченные консультации." />
      <div className="card card--teal">
        <Illustration name="consult" height={170} blob="#BFE0DB" alt="" />
      </div>
      <ul className="list-reset stack">
        {CONSULTATIONS.map((c) => (
          <li key={c.name} className="card row" style={{ alignItems: 'flex-start' }}>
            <Icon name="people" color="var(--c-teal)" />
            <div className="stack-s">
              <h3>{c.name}</h3>
              <p className="small text-2">{c.text}</p>
            </div>
          </li>
        ))}
      </ul>
      {FAQ_CONSULTATIONS.notes.map((note) => (
        <div key={note} className="alert alert--info">
          {note}
        </div>
      ))}
    </>
  );
}

export function NotFoundPage() {
  return (
    <div className="card stack" style={{ textAlign: 'center', alignItems: 'center' }}>
      <Illustration name="mailbox" height={160} blob="#FCEFC9" />
      <h1 style={{ fontSize: 24 }}>Такой страницы нет</h1>
      <Link to="/" className="btn btn--secondary">
        На главную
      </Link>
    </div>
  );
}
