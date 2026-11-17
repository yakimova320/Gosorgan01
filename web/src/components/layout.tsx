import type { ReactNode } from 'react';
import { DATA_MODE, IS_PRODUCTION } from '../api/config';
import { Link, NavLink } from 'react-router';
import { useSession } from '../store';
import { Icon } from './Icon';
import { Logo } from './ui';

/** Видно только в разработке: какой режим данных сейчас (mock или api). */
export function ModeBadge() {
  if (IS_PRODUCTION) return null;
  return <div className="mode-badge">{DATA_MODE === 'mock' ? 'примерные данные' : 'сервер'}</div>;
}

export function PublicLayout({ children }: { children: ReactNode }) {
  const { token } = useSession();
  return (
    <>
      <header className="topbar">
        <Link to="/" aria-label="Ja!sno, на главную">
          <Logo />
        </Link>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip" title="Пока только русский язык" style={{ minHeight: 36, borderRadius: 12 }}>
            RU
          </span>
          <Link to={token ? '/app' : '/login'} className="btn btn--navy btn--small" style={{ minHeight: 36, borderRadius: 12 }}>
            {token ? 'Кабинет' : 'Войти'}
          </Link>
        </div>
      </header>
      <main className="page page--public">{children}</main>
      <footer className="footer">
        <Link to="/faq">Частые вопросы</Link>
        <Link to="/wissen">Важно знать</Link>
        <span>Конфиденциальность (готовится)</span>
        <span>Impressum (готовится)</span>
        <span style={{ flexBasis: '100%', lineHeight: 1.5 }}>
          Ja!sno объясняет письма и не заменяет юридическую консультацию. Тестовая версия: только примеры писем.
        </span>
      </footer>
    </>
  );
}

const MAIN_NAV = [
  { to: '/app', label: 'Кабинет', icon: 'home', exact: true },
  { to: '/app/cases', label: 'Мои дела', icon: 'folder', exact: false },
  { to: '/app/history', label: 'История', icon: 'history', exact: false },
  { to: '/app/ask', label: 'Спросить', icon: 'chat', exact: false },
  { to: '/app/write', label: 'Написать письмо', icon: 'pen', exact: false },
  { to: '/wissen', label: 'Важно знать', icon: 'book', exact: false },
  { to: '/app/profile', label: 'Профиль', icon: 'user', exact: false },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <nav className="side-nav" aria-label="Главное меню">
        <Link to="/app" style={{ padding: '0 12px 12px' }} aria-label="Ja!sno, кабинет">
          <Logo />
        </Link>
        <Link to="/app/scan" className="btn btn--primary">
          <Icon name="scan" size={20} color="#FFFFFF" width={2.2} /> Новое письмо
        </Link>
        {MAIN_NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.exact}>
            <Icon name={n.icon} size={20} /> {n.label}
          </NavLink>
        ))}
      </nav>

      <main className="page">{children}</main>

      <nav className="bottom-nav" aria-label="Главное меню">
        <NavLink to="/app" end>
          <Icon name="home" />
          Кабинет
        </NavLink>
        <NavLink to="/app/history">
          <Icon name="history" />
          История
        </NavLink>
        <Link to="/app/scan" aria-label="Сфотографировать письмо" style={{ justifyContent: 'center' }}>
          <span className="fab">
            <Icon name="scan" size={24} color="#FFFFFF" width={2.2} />
          </span>
        </Link>
        <NavLink to="/app/ask">
          <Icon name="chat" />
          Спросить
        </NavLink>
        <NavLink to="/app/profile">
          <Icon name="user" />
          Профиль
        </NavLink>
      </nav>
    </div>
  );
}
