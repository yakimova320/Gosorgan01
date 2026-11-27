import { Icon } from '../../components/Icon';
import { Illustration, type IllustrationName } from '../../components/Watercolor';
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useSession } from '../../store';
import { CARDS, HOME_FAQ, TOPICS, type FaqItem } from '../../content';
import { t } from '../../i18n';

const STEPS = [
  {
    n: 1,
    title: t('Сфотографируйте письмо'),
    text: t('Прямо в браузере, без приложения. Или загрузите PDF.'),
    illu: 'scan',
    blob: '#FBE3D6',
  },
  {
    n: 2,
    title: t('Проверьте и спросите'),
    text: t('Ja!sno объяснит по-русски: о чём письмо, что сделать и до какого числа.'),
    illu: 'talk',
    blob: '#DDEFEC',
  },
  {
    n: 3,
    title: t('Выдохните'),
    text: t('Черновик ответа на немецком готов, срок виден в деле.'),
    illu: 'relief',
    blob: '#FCEFC9',
  },
] as const;

/** UX 26.11: карточки «А вы знали, что…?» (content/important/cards.*.json, внутренний id темы hot) */
const FACTS = CARDS.filter((c) => c.topic === 'hot' && !c.draft);
/** Сколько тем видно сразу, остальные по кнопке «Ещё актуальные темы». */
const FACTS_SHOWN = 4;

/**
 * UX 27.11 (#172): картинка темы по id (не по порядку) на акварельном пятне того же тона.
 * Файл ensurance.webp назван так в макете, имя не меняем.
 */
const TOPIC_ART: Record<string, { illu: IllustrationName; blob: string }> = {
  children: { illu: 'family', blob: '#FBE3D6' },
  housing: { illu: 'living', blob: '#F6D2D0' },
  insurance: { illu: 'ensurance', blob: '#FCEFC9' },
  health: { illu: 'health', blob: '#DDEFEC' },
};
const HOME_TOPICS = TOPICS.filter((topic) => topic.id in TOPIC_ART);

export function StartPage() {
  const { token } = useSession();
  // Решение 16.3: письма разбираются только после регистрации.
  const start = token ? '/app/scan' : '/register';
  // A01: сообщение после удаления аккаунта (state из формы удаления)
  const location = useLocation();
  const deleted = (
    location.state as { accountDeleted?: 'done' | 'pending' } | null
  )?.accountDeleted;

  // UX 26.11: пункт меню и ссылка в подвале «Как это работает?» ведут на /#how
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
  }, [location.hash, location.key]);

  return (
    <>
      {deleted && (
        <div
          className="alert alert--info"
          role="status"
          data-testid="account-deleted"
        >
          {deleted === 'pending'
            ? t('Удаление аккаунта продолжается. Повторять запрос не нужно')
            : t('Аккаунт и все данные удалены')}
        </div>
      )}
      <section className="card card--hero card--peach">
        <div className="hero-grid stack">
          <div className="stack">
            <h1 style={{ fontSize: 31 }}>
              {t('Письмо из ведомства?')}
              <br />
              <span style={{ color: 'var(--c-orange)' }}>{t('Не переживайте.')}</span>
            </h1>
            <p className="text-2" style={{ fontSize: 15 }}>
              {t('Объясним по-русски, что в нём написано, что сделать и до какого числа. Поможем ответить на немецком.')}
            </p>
            <div className="stack" style={{ maxWidth: 420 }}>
              <Link to={start} className="btn btn--primary">
                <Icon name="scan" size={20} color="#FFFFFF" width={2.2} />{' '}
                {t('Сфотографировать письмо')}
              </Link>
              <Link to={start} className="btn btn--secondary">
                {t('Загрузить PDF')}
              </Link>
              {!token && (
                <span className="muted">
                  {t('Чтобы сохранить письма в своих делах, нужна регистрация: e-mail и пароль.')}
                </span>
              )}
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <Illustration
              name="worried"
              height={300}
              blob="#F6C9B2"
              alt={t('Молодой человек растерянно читает письмо из ведомства')}
            />
            <div
              className="row"
              style={{ position: 'absolute', right: 0, bottom: 26 }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'var(--c-navy)',
                  color: '#F7F5F0',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-head)',
                  fontWeight: 800,
                  fontSize: 19,
                }}
              >
                J<span style={{ color: 'var(--c-orange)' }}>!</span>
              </span>
              <span
                style={{
                  background: '#fff',
                  borderRadius: '4px 16px 16px 16px',
                  padding: '8px 12px',
                  fontFamily: 'var(--font-head)',
                  fontSize: 14,
                  fontWeight: 700,
                  boxShadow: '0 4px 12px rgba(30,42,74,.08)',
                }}
              >
                {t('Разберёмся!')}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="row wrap" style={{ gap: 8 }}>
        {[
          t('Без установки'),
          t('Тестовая версия бесплатная'),
          t('Можно удалить всё'),
        ].map((t) => (
          <span key={t} className="chip">
            <Icon name="check" size={15} color="var(--c-teal)" width={2.4} />
            {t}
          </span>
        ))}
      </div>

      <section id="how" className="stack" style={{ paddingTop: 12, scrollMarginTop: 16 }} aria-labelledby="how-title">
        <h2 id="how-title">{t('Как это работает в 3 шага?')}</h2>
        <div className="steps-grid stack">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="card row"
              style={{ padding: '10px 14px 10px 8px' }}
            >
              <div style={{ width: 104, flex: '0 0 104px' }}>
                <Illustration name={s.illu} height={112} blob={s.blob} />
              </div>
              <div className="stack-s">
                <span className="eyebrow">{t('Шаг')}{' '}{s.n}</span>
                <h3>{s.title}</h3>
                <span className="small text-2">{s.text}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* UX 26.11: блог, первым «А вы знали, что…?», потом категории */}
      <section className="stack" style={{ paddingTop: 12 }} aria-labelledby="blog-title">
        <div className="row-between">
          <div className="stack-s">
            <h2 id="blog-title">{t('Блог')}</h2>
            <p className="text-2" style={{ margin: 0 }}>
              {t('Важное о жизни в Германии — просто и понятно')}
            </p>
          </div>
          <Link to="/blog" className="link">
            {t('Все темы')}
          </Link>
        </div>

        <FactsBlock />

        <div className="grid-2 cards-4" data-testid="home-topics">
          {HOME_TOPICS.map((topic) => {
            const first = CARDS.find((c) => c.topic === topic.id);
            const art = TOPIC_ART[topic.id];
            return (
              <Link
                key={topic.id}
                to={`/blog?topic=${topic.id}`}
                className="card stack-s topic-card"
                data-topic={topic.id}
              >
                <Illustration name={art.illu} height={120} blob={art.blob} />
                <h3>{topic.title}</h3>
                <span className="muted" style={{ fontSize: 12 }}>
                  {first?.title}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* UX 27.11 (#172): от 768 px две колонки — слева крупный заголовок и кнопка, справа рисунок */}
      <section className="card card--teal consult" aria-labelledby="consult-title" data-testid="consult">
        <div className="stack consult__text">
          <h2 id="consult-title" className="consult__title">
            {t('Сложный случай? Подскажем, куда обратиться')}
          </h2>
          <p className="small" style={{ color: '#2F4A52', margin: 0 }}>
            {t('Если нужно возражение (Widerspruch) или совет юриста, Ja!sno назовёт, где получить консультацию.')}
          </p>
          <Link to="/beratung" className="btn btn--teal" style={{ alignSelf: 'flex-start' }}>
            {t('Найти консультацию')}
          </Link>
        </div>
        <div className="consult__art">
          <Illustration name="consult" height={280} blob="#BFE0DB" alt={t('Двое разбирают письмо за столом')} />
        </div>
      </section>

      <GoodToKnow />
      <Prices />
    </>
  );
}

/**
 * UX 27.11 (#172): тарифы. Оплаты на сайте нет: у платных пометка «скоро», кнопок покупки нет,
 * лимит разборов в коде не вводится. Тексты подтвердила Настя 27.11.
 */
const PLANS = [
  { id: 'start', name: t('Старт'), price: '0 €', text: t('Хранение писем, 3 разбора в месяц, календарь и напоминания.'), paid: false },
  { id: 'plus', name: 'Ja!sno Plus', price: '4,99 €', text: t('Разборы без лимита, архив, экспорт.'), paid: true },
  { id: 'family', name: t('Семья'), price: '12,99 €', text: t('Один аккаунт на несколько человек.'), paid: true },
] as const;

function Prices() {
  return (
    <section id="preise" className="stack" style={{ paddingTop: 12, scrollMarginTop: 16 }} aria-labelledby="preise-title" data-testid="prices">
      <h2 id="preise-title">{t('Тарифы')}</h2>
      <ul className="list-reset pricing">
        {PLANS.map((p) => (
          <li key={p.id} className={p.id === 'plus' ? 'price price--featured' : 'price'} data-plan={p.id}>
            <h3 className="price__name">{p.name}</h3>
            <p className="price__value">
              <span className="price__amount">{p.price}</span>
              {p.paid && <span className="price__per"> {t('в месяц')}</span>}
            </p>
            <p className="price__text">{p.text}</p>
            {p.paid && <span className="price__soon">{t('скоро')}</span>}
          </li>
        ))}
      </ul>
      <p className="small text-2" style={{ margin: 0 }}>
        {t('Тестовая версия бесплатная')}.
      </p>
    </section>
  );
}

/** UX 26.11 (#168): «А вы знали, что…?»: 4 темы сразу, остальные по кнопке. */
function FactsBlock() {
  const [all, setAll] = useState(false);
  const shown = all ? FACTS : FACTS.slice(0, FACTS_SHOWN);
  return (
    <section className="card card--green stack" style={{ borderRadius: 28 }} aria-labelledby="facts-title" data-testid="hot-topics">
      <div className="row" style={{ gap: 10 }}>
        <Icon name="info" color="var(--c-green)" />
        <h3 id="facts-title" style={{ fontSize: 20 }}>
          {t('А вы знали, что…?')}
        </h3>
      </div>
      <ul id="facts-list" className="list-reset facts-list" data-testid="facts-list">
        {shown.map((c) => (
          <li key={c.id}>
            <Link to={`/blog?topic=hot#${c.id}`}>
              <span>{c.title}</span>
              <Icon name="arrowRight" size={18} />
            </Link>
          </li>
        ))}
      </ul>
      {FACTS.length > FACTS_SHOWN && (
        <button
          type="button"
          className="btn btn--green btn--small"
          style={{ alignSelf: 'flex-start' }}
          aria-expanded={all}
          aria-controls="facts-list"
          onClick={() => setAll((v) => !v)}
        >
          {all ? t('Свернуть') : t('Ещё актуальные темы')}
        </button>
      )}
    </section>
  );
}

function FaqAnswer({ item }: { item: FaqItem }) {
  return (
    <div className="faq-body">
      {item.blocks.map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>{b.text}</p>
        ) : b.kind === 'ul' ? (
          <ul key={i}>
            {b.items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          <ol key={i}>
            {b.items.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

/** UX 26.11 (#168): «Полезно знать»: сначала глоссарий, потом главные вопросы FAQ (тексты из content/faq.*.md). */
function GoodToKnow() {
  return (
    <section className="stack" style={{ paddingTop: 12 }} aria-labelledby="good-title" data-testid="good-to-know">
      <h2 id="good-title">{t('Полезно знать')}</h2>
      <div className="desktop-2col stack">
        <div className="card stack">
          <div className="row" style={{ gap: 10 }}>
            <Icon name="book" color="var(--c-teal)" />
            <h3 style={{ fontSize: 19 }}>{t('Глоссарий')}</h3>
          </div>
          <p className="small text-2">
            {t('Слова из писем ведомств простыми словами: Bescheid, Frist, Widerspruch и другие.')}
          </p>
          <Link to="/glossary" className="btn btn--secondary btn--small" style={{ alignSelf: 'flex-start' }}>
            {t('К глоссарию')}
          </Link>
        </div>
        <div className="card stack">
          <div className="row" style={{ gap: 10 }}>
            <Icon name="help" color="var(--c-teal)" />
            <h3 style={{ fontSize: 19 }}>FAQ</h3>
          </div>
          <div className="stack-s" data-testid="home-faq">
            {HOME_FAQ.map((item) => (
              <details key={item.question} className="faq">
                <summary>{item.question}</summary>
                <FaqAnswer item={item} />
              </details>
            ))}
          </div>
          <Link to="/faq" className="btn btn--secondary btn--small" style={{ alignSelf: 'flex-start' }}>
            {t('Все вопросы FAQ')}
          </Link>
        </div>
      </div>
    </section>
  );
}
