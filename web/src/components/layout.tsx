import type { ReactNode } from 'react';
import { DATA_MODE, IS_PRODUCTION } from '../api/config';
import { Link, NavLink } from 'react-router';
import { useSession } from '../store';
import { useCabinetQuery } from '../store/api';
import { greeting } from '../lib/greeting';
import { Icon } from './Icon';
import { Logo } from './ui';
import { LanguageSwitcher, useCabinetLanguageSync } from './LanguageSwitcher';
import { ChatLauncher } from './ChatLauncher';
import { setChatOpen, useDisclosure } from '../lib/disclosure';
import { t } from '../i18n';

/** Видно только в разработке: какой режим данных сейчас (mock или api). */
export function ModeBadge() {
  if (IS_PRODUCTION) return null;
  return <div className="mode-badge">{DATA_MODE === 'mock' ? t('примерные данные') : t('сервер')}</div>;
}

/**
 * Правка 18-11: в режиме mock сайт работает на примерных данных и ничего не сохраняет
 * (регистрация, письма, дела). Маленького значка в углу не хватало: на это легко принять mock за ошибки.
 */
export function MockBanner() {
  if (DATA_MODE !== 'mock') return null;
  return (
    <div className="mock-banner" role="note" data-testid="mock-banner">
      {t('Примерные данные: ничего не сохраняется и не отправляется на сервер. Для настоящей работы запустите сайт с')}{' '}<code>VITE_DATA_MODE=api</code> (README).
    </div>
  );
}

/** UX 26.11: ссылка на блок «Как это работает» на главной (/#how). */
const HOW = { pathname: '/', hash: '#how' } as const;
/** UX 27.11: раздел тарифов на главной (/#preise). */
const PRICES = { pathname: '/', hash: '#preise' } as const;

function BurgerIcon({ open }: { open: boolean }) {
  return open ? <Icon name="x" size={22} /> : <Icon name="menu" size={22} />;
}

/**
 * UX 26.11 (#168): бургер-меню на публичных страницах, на всех ширинах.
 * «Задать вопрос» открывает плавающий чат.
 */
function PublicMenu() {
  const { token } = useSession();
  const d = useDisclosure();
  return (
    <div className="menu">
      <button
        ref={d.buttonRef}
        type="button"
        className="icon-btn menu__button"
        {...d.buttonProps}
        aria-label={t('Меню')}
        onClick={d.toggle}
        data-testid="public-menu-button"
      >
        <BurgerIcon open={d.open} />
      </button>
      {d.open && (
        <nav id={d.panelId} ref={d.panelRef} className="menu__panel" aria-label={t('Меню')} data-testid="public-menu">
          <Link to="/" onClick={() => d.close(false)}>
            <Icon name="home" size={20} /> {t('Главная страница')}
          </Link>
          <Link to={token ? '/app' : '/login'} onClick={() => d.close(false)}>
            <Icon name="user" size={20} /> {t('Кабинет')}
          </Link>
          <Link to={HOW} onClick={() => d.close(false)}>
            <Icon name="help" size={20} /> {t('Как это работает?')}
          </Link>
          <button
            type="button"
            onClick={() => {
              d.close(false);
              setChatOpen(true);
            }}
          >
            <Icon name="chat" size={20} /> {t('Задать вопрос')}
          </button>
          <Link to="/formulare" onClick={() => d.close(false)}>
            <Icon name="edit" size={20} /> {t('Формуляры')}
          </Link>
          <Link to="/blog" onClick={() => d.close(false)}>
            <Icon name="book" size={20} /> {t('Блог')}
          </Link>
          <Link to="/faq" onClick={() => d.close(false)}>
            <Icon name="info" size={20} /> FAQ
          </Link>
        </nav>
      )}
    </div>
  );
}

export function PublicLayout({ children }: { children: ReactNode }) {
  const { token } = useSession();
  return (
    <>
      <header className="topbar">
        <div className="row" style={{ gap: 6 }}>
          <PublicMenu />
          <Link to="/" aria-label={t('Ja!sno, на главную')}>
            <Logo />
          </Link>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <LanguageSwitcher />
          <Link to={token ? '/app' : '/login'} className="btn btn--navy btn--small" style={{ minHeight: 44, borderRadius: 12 }}>
            {token ? t('Кабинет') : t('Войти')}
          </Link>
        </div>
      </header>
      <main className="page page--public">{children}</main>
      <SiteFooter />
      <ChatLauncher />
    </>
  );
}

/**
 * UX 26.11 (#168): тёмный подвал, ссылки группами. Один подвал на всех страницах — публичных и в кабинете.
 * UX 27.11 (#172): две колонки рядом по левому краю, без линии между ними; дисклеймер под обеими.
 * Поправка 3 (23.11): «Частые вопросы» в подвале называются FAQ.
 */
export function SiteFooter() {
  return (
    <footer className="footer" data-testid="site-footer">
      <div className="footer__inner">
        <nav className="footer__group" aria-label={t('Правовая информация')}>
          <Link to="/impressum">Impressum</Link>
          <Link to="/datenschutz">Datenschutz</Link>
          <Link to="/agb">AGB</Link>
        </nav>
        <nav className="footer__group" aria-label={t('Разделы сайта')}>
          <Link to="/">{t('Главная страница')}</Link>
          <Link to="/blog">{t('Блог')}</Link>
          <Link to="/faq">FAQ</Link>
          <Link to="/glossary">{t('Глоссарий')}</Link>
          <Link to={HOW}>{t('Как это работает?')}</Link>
          <Link to={PRICES}>{t('Тарифы')}</Link>
        </nav>
        <p className="footer__note">
          {t('Ja!sno объясняет письма и не заменяет юридическую консультацию. Тестовая версия: только примеры писем.')}
        </p>
      </div>
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
  { to: '/', label: t('Главная'), icon: 'home', exact: true },
  { to: '/app', label: t('Кабинет'), icon: 'doc', exact: true },
  { to: '/app/cases', label: t('Мои дела'), icon: 'folder', exact: false },
  { to: '/app/history', label: t('История'), icon: 'history', exact: false },
  // чат-помощник (24.11)
  { to: '/app/ask', label: t('Спросить Ja!sno'), icon: 'chat', exact: false },
  { to: '/app/write', label: t('Написать письмо'), icon: 'pen', exact: false },
  // UX 27.11 (#172): «Формуляры», пока страница с пометкой «скоро»
  { to: '/formulare', label: t('Формуляры'), icon: 'edit', exact: false },
  { to: '/blog', label: t('Блог'), icon: 'book', exact: false },
  // UX 26.11: Glossar в меню кабинета (боковое на компьютере, бургер на телефоне)
  { to: '/glossary', label: t('Глоссарий'), icon: 'search', exact: false },
  { to: '/app/profile', label: t('Профиль'), icon: 'user', exact: false },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  useCabinetLanguageSync();
  return (
    <div className="app-shell">
      <nav className="side-nav" aria-label={t('Главное меню')}>
        <Link to="/" style={{ padding: '0 12px 12px' }} aria-label={t('Ja!sno, на главную')}>
          <Logo />
        </Link>
        <Link to="/app/scan" className="btn btn--primary">
          <Icon name="scan" size={20} color="#FFFFFF" width={2.2} />{' '}{t('Новое письмо')}
        </Link>
        {MAIN_NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.exact}>
            <Icon name={n.icon} size={20} /> {n.label}
          </NavLink>
        ))}
        <SideNavGreeting />
        <div style={{ padding: '0 12px' }}>
          <LanguageSwitcher />
        </div>
      </nav>

      <div className="app-main">
        {/* UX 26.11: на телефоне в шапке только логотип, остальное в меню снизу */}
        <header className="app-topbar">
          <Link to="/" aria-label={t('Ja!sno, на главную')}>
            <Logo />
          </Link>
        </header>
        <main className="page">{children}</main>
        <div className="app-footer">
          <SiteFooter />
        </div>
      </div>

      <ChatLauncher inCabinet />

      {/* UX 26.11 (#168): Меню · Кабинет · камера · Мои дела · Профиль. История и блог в меню. */}
      <nav className="bottom-nav" aria-label={t('Главное меню')}>
        <CabinetMenu />
        <NavLink to="/app" end>
          <Icon name="doc" />
          {t('Кабинет')}
        </NavLink>
        <Link to="/app/scan" aria-label={t('Сфотографировать письмо')} style={{ justifyContent: 'center' }}>
          <span className="fab">
            <Icon name="scan" size={24} color="#FFFFFF" width={2.2} />
          </span>
        </Link>
        <NavLink to="/app/cases">
          <Icon name="folder" />
          {t('Мои дела')}
        </NavLink>
        <NavLink to="/app/profile">
          <Icon name="user" />
          {t('Профиль')}
        </NavLink>
      </nav>
    </div>
  );
}

/** UX 26.11 (#168): бургер в нижней панели кабинета, меню раскрывается снизу вверх. Пункты из MAIN_NAV. */
function CabinetMenu() {
  const d = useDisclosure();
  return (
    <>
      <button
        ref={d.buttonRef}
        type="button"
        className="bottom-nav__menu"
        {...d.buttonProps}
        onClick={d.toggle}
        data-testid="cabinet-menu-button"
      >
        <BurgerIcon open={d.open} />
        {t('Меню')}
      </button>
      {d.open && (
        <div id={d.panelId} ref={d.panelRef} className="menu__panel menu__panel--sheet" data-testid="cabinet-menu">
          <nav aria-label={t('Меню')} className="stack-s" style={{ gap: 2 }}>
            {MAIN_NAV.filter((n) => n.to !== '/app').map((n) => (
              <NavLink key={n.to} to={n.to} end={n.exact} onClick={() => d.close(false)}>
                <Icon name={n.icon} size={20} /> {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="menu__lang">
            <span className="muted">{t('Язык')}</span>
            <LanguageSwitcher placement="up" />
          </div>
        </div>
      )}
    </>
  );
}
