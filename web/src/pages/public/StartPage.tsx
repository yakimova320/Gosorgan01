import { Icon } from '../../components/Icon';
import { Illustration } from '../../components/Watercolor';
import { Link } from 'react-router';
import { useSession } from '../../store';
import { CARDS, TOPICS } from '../../content';

const STEPS = [
  { n: 1, title: 'Сфотографируйте письмо', text: 'Прямо в браузере, без приложения. Или загрузите PDF.', illu: 'scan', blob: '#FBE3D6' },
  { n: 2, title: 'Проверьте и спросите', text: 'Ja!sno объяснит по-русски: о чём письмо, что сделать и до какого числа.', illu: 'talk', blob: '#DDEFEC' },
  { n: 3, title: 'Выдохните', text: 'Черновик ответа на немецком готов, срок виден в деле.', illu: 'relief', blob: '#FCEFC9' },
] as const;

const TOPIC_BLOBS = ['#FBE3D6', '#F6D2D0', '#FCEFC9', '#DDEFEC', '#FBE3D6', '#F6D2D0'];

export function StartPage() {
  const { token } = useSession();
  // Решение 16.3: письма разбираются только после регистрации.
  const start = token ? '/app/scan' : '/register';

  return (
    <>
      <section className="card card--hero card--peach">
        <div className="hero-grid stack">
          <div className="stack">
            <h1 style={{ fontSize: 31 }}>
              Письмо из ведомства?
              <br />
              <span style={{ color: 'var(--c-orange)' }}>Не переживайте.</span>
            </h1>
            <p className="text-2" style={{ fontSize: 15 }}>
              Объясним по-русски, что в нём написано, что сделать и до какого числа. Поможем ответить на немецком.
            </p>
            <div className="stack" style={{ maxWidth: 420 }}>
              <Link to={start} className="btn btn--primary">
                <Icon name="scan" size={20} color="#FFFFFF" width={2.2} /> Сфотографировать письмо
              </Link>
              <Link to={start} className="btn btn--secondary">
                Загрузить PDF
              </Link>
              {!token && <span className="muted">Чтобы сохранить письма в своих делах, нужна регистрация: e-mail и пароль.</span>}
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <Illustration name="worried" height={300} blob="#F6C9B2" alt="Молодой человек растерянно читает письмо из ведомства" />
            <div className="row" style={{ position: 'absolute', right: 0, bottom: 26 }}>
              <span
                aria-hidden="true"
                style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--c-navy)', color: '#F7F5F0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-head)', fontWeight: 800, fontSize: 19 }}
              >
                J<span style={{ color: 'var(--c-orange)' }}>!</span>
              </span>
              <span style={{ background: '#fff', borderRadius: '4px 16px 16px 16px', padding: '8px 12px', fontFamily: 'var(--font-head)', fontSize: 14, fontWeight: 700, boxShadow: '0 4px 12px rgba(30,42,74,.08)' }}>
                Разберёмся!
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="row wrap" style={{ gap: 8 }}>
        {['Без установки', 'Тестовая версия бесплатная', 'Можно удалить всё'].map((t) => (
          <span key={t} className="chip">
            <Icon name="check" size={15} color="var(--c-teal)" width={2.4} />
            {t}
          </span>
        ))}
      </div>

      <section className="stack" style={{ paddingTop: 12 }}>
        <h2>Три шага до спокойствия</h2>
        <div className="steps-grid stack">
          {STEPS.map((s) => (
            <div key={s.n} className="card row" style={{ padding: '10px 14px 10px 8px' }}>
              <div style={{ width: 104, flex: '0 0 104px' }}>
                <Illustration name={s.illu} height={112} blob={s.blob} />
              </div>
              <div className="stack-s">
                <span className="eyebrow">Шаг {s.n}</span>
                <h3>{s.title}</h3>
                <span className="small text-2">{s.text}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="stack" style={{ paddingTop: 12 }}>
        <div className="row-between">
          <h2>Важно знать</h2>
          <Link to="/wissen" className="link">
            Все темы
          </Link>
        </div>
        <div className="grid-2 cards-4">
          {TOPICS.slice(0, 4).map((t, i) => {
            const first = CARDS.find((c) => c.topic === t.id);
            return (
              <Link key={t.id} to={`/wissen?topic=${t.id}`} className="card stack-s" style={{ borderRadius: 22 }}>
                <span style={{ width: 40, height: 8, borderRadius: 4, background: TOPIC_BLOBS[i] }} />
                <h3>{t.title}</h3>
                <span className="muted" style={{ fontSize: 12 }}>
                  {first?.title}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="card card--teal stack" style={{ borderRadius: 28, marginTop: 12 }}>
        <Illustration name="consult" height={190} blob="#BFE0DB" alt="Двое разбирают письмо за столом" />
        <h2 style={{ fontSize: 20 }}>Сложный случай? Подскажем, куда обратиться</h2>
        <p className="small" style={{ color: '#2F4A52' }}>
          Если нужно возражение (Widerspruch) или совет юриста, Ja!sno назовёт, где получить консультацию.
        </p>
        <Link to="/beratung" className="btn btn--teal btn--small" style={{ alignSelf: 'flex-start' }}>
          Найти консультацию
        </Link>
      </section>
    </>
  );
}
