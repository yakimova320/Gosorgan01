import type { ReactNode } from 'react';
import { DATA_MODE, IS_PRODUCTION } from '../api/config';
import { Link, NavLink } from 'react-router';
import { useSession } from '../store';
import { useCabinetQuery } from '../store/api';
import { greeting } from '../lib/greeting';
import { Icon } from './Icon';
import { Logo } from './ui';

/** Видно только в разработке: какой режим данных сейчас (mock или api). */
export function ModeBadge() {
  if (IS_PRODUCTION) return null;
  return <div className="mode-badge">{DATA_MODE === 'mock' ? 'примерные данные' : 'сервер'}</div>;
}

/**
 * Правка 18-11: в режиме mock сайт работает на примерных данных и ничего не сохраняет
 * (регистрация, письма, дела). Маленького значка в углу не хватало: на это легко принять mock за ошибки.
 */
export function MockBanner() {
  if (DATA_MODE !== 'mock') return null;
  return (
    <div className="mock-banner" role="note" data-testid="mock-banner">
      Примерные данные: ничего не сохраняется и не отправляется на сервер. Для настоящей работы запустите сайт
      с <code>VITE_DATA_MODE=api</code> (README).
    </div>
  );
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
      <SiteFooter />
    </>
  );
}

/**
 * Поправки 3 и 7 (23.11): один подвал на всех страницах — публичных и в кабинете.
 * Поправка 3: «Частые вопросы» в подвале называются FAQ.
 */
export function SiteFooter() {
  return (
    <footer className="footer" data-testid="site-footer">
      <Link to="/">На главную Ja!sno</Link>
      <Link to="/blog">Блог</Link>
      <Link to="/faq">FAQ</Link>
      <Link to="/impressum">Impressum</Link>
      <Link to="/datenschutz">Datenschutz</Link>
      <span style={{ flexBasis: '100%', lineHeight: 1.5 }}>
        Ja!sno объясняет письма и не заменяет юридическую консультацию. Тестовая версия: только примеры писем.
      </span>
    </footer>
  );
}

/** Поправка 5 (23.11): внизу бокового меню приветствие с именем, например «Добрый вечер, Anna». */
function SideNavGreeting() {
  const cabinet = useCabinetQuery();
  const name = cabinet.data?.profile?.firstName;
  return (
    <div className="side-nav__user" data-testid="side-nav-user">
      <span className="muted">{greeting()},</span>
      <strong>{name ?? '…'}</strong>
    </div>
  );
}

const MAIN_NAV = [
  // поправка 4 (23.11): «Главная» ведёт на публичную главную, как логотип
  { to: '/', label: 'Главная', icon: 'home', exact: true },
  { to: '/app', label: 'Кабинет', icon: 'doc', exact: true },
  { to: '/app/cases', label: 'Мои дела', icon: 'folder', exact: false },
  { to: '/app/history', label: 'История', icon: 'history', exact: false },
  // чат-помощник (24.11)
  { to: '/app/ask', label: 'Спросить Ja!sno', icon: 'chat', exact: false },
  { to: '/app/write', label: 'Написать письмо', icon: 'pen', exact: false },
  { to: '/blog', label: 'Блог', icon: 'book', exact: false },
  { to: '/app/profile', label: 'Профиль', icon: 'user', exact: false },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <nav className="side-nav" aria-label="Главное меню">
        <Link to="/" style={{ padding: '0 12px 12px' }} aria-label="Ja!sno, на главную">
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
        <SideNavGreeting />
      </nav>

      <div className="app-main">
        {/* Поправка 4: на телефоне логотип и «Главная» над страницей кабинета */}
        <header className="app-topbar">
          <Link to="/" aria-label="Ja!sno, на главную">
            <Logo />
          </Link>
          <div className="row" style={{ gap: 4 }}>
            <Link to="/app/ask" className="btn btn--ghost btn--small" data-testid="ask-link">
              <Icon name="chat" size={18} /> Спросить
            </Link>
            <Link to="/" className="btn btn--ghost btn--small" data-testid="home-link">
              <Icon name="home" size={18} /> Главная
            </Link>
          </div>
        </header>
        <main className="page">{children}</main>
        <div className="app-footer">
          <SiteFooter />
        </div>
      </div>

      <nav className="bottom-nav" aria-label="Главное меню">
        <NavLink to="/app" end>
          <Icon name="doc" />
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
        <NavLink to="/blog">
          <Icon name="book" />
          Блог
        </NavLink>
        <NavLink to="/app/profile">
          <Icon name="user" />
          Профиль
        </NavLink>
      </nav>
    </div>
  );
}
