import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

/*
 * Маленький маршрутизатор на History API: адреса как /app/cases/123, кнопка «Назад» браузера работает.
 * Своя реализация вместо React Router, чтобы не тянуть зависимость ради 30 маршрутов.
 */

interface NavigateOptions {
  replace?: boolean;
}

interface RouterValue {
  path: string;
  search: URLSearchParams;
  navigate: (to: string, options?: NavigateOptions) => void;
  back: (fallback?: string) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

/**
 * Адреса после «#» вместо обычного пути: когда сайт открыт как файл (офлайн-показ без сервера)
 * или в демо-сборке, где страница задаёт window.__JASNO_HASH__ = true.
 */
const FILE_MODE =
  typeof window !== 'undefined' &&
  (window.location.protocol === 'file:' || (window as unknown as { __JASNO_HASH__?: boolean }).__JASNO_HASH__ === true);

function currentUrl(): string {
  if (typeof window === 'undefined') return '/';
  if (FILE_MODE) return window.location.hash.slice(1) || '/';
  return window.location.pathname + window.location.search;
}

export function RouterProvider({ initialPath, children }: { initialPath?: string; children: ReactNode }) {
  const [url, setUrl] = useState<string>(() => initialPath ?? currentUrl());

  useEffect(() => {
    const onPop = () => setUrl(currentUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, options?: NavigateOptions) => {
    if (typeof window !== 'undefined') {
      const target = FILE_MODE ? `#${to}` : to;
      if (options?.replace) window.history.replaceState(null, '', target);
      else window.history.pushState(null, '', target);
      window.scrollTo(0, 0);
    }
    setUrl(to);
  }, []);

  const back = useCallback(
    (fallback = '/app') => {
      if (typeof window !== 'undefined' && window.history.length > 1) window.history.back();
      else navigate(fallback);
    },
    [navigate],
  );

  const value = useMemo<RouterValue>(() => {
    const [pathPart, query = ''] = url.split('?');
    return { path: pathPart || '/', search: new URLSearchParams(query), navigate, back };
  }, [url, navigate, back]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter: нет RouterProvider');
  return value;
}

export type Params = Record<string, string>;

/** '/app/cases/:id' и '/app/cases/42' → { id: '42' }; не совпало → null */
export function matchPath(pattern: string, path: string): Params | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handleClick} {...rest} />;
}

/** Ссылка меню: отмечает текущий раздел через aria-current="page". */
export function NavLink({ to, exact = false, ...rest }: LinkProps & { exact?: boolean }) {
  const { path } = useRouter();
  const active = exact ? path === to : path === to || path.startsWith(`${to}/`);
  return <Link to={to} aria-current={active ? 'page' : undefined} {...rest} />;
}

export function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}
