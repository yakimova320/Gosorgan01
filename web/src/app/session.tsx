import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setUnauthorizedHandler } from '../api/http';

/*
 * Токен сессии хранится в localStorage браузера (ТЗ v2: Bearer-токен).
 * Минус: скрипт на странице может его прочитать, поэтому сайт не вставляет чужой HTML (ответы модели выводятся как текст).
 */

const KEY = 'jasno.session';

function readToken(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Браузер запретил хранение (приватный режим): сессия живёт до перезагрузки страницы.
  }
}

interface SessionValue {
  token: string | null;
  /** true: сервер отклонил сессию (истекла), экран входа показывает пояснение */
  expired: boolean;
  signIn: (token: string) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children, initialToken }: { children: ReactNode; initialToken?: string | null }) {
  const [token, setToken] = useState<string | null>(() => (initialToken !== undefined ? initialToken : readToken()));

  const [expired, setExpired] = useState(false);

  const signIn = useCallback((t: string) => {
    writeToken(t);
    setToken(t);
    setExpired(false);
  }, []);

  const signOut = useCallback(() => {
    writeToken(null);
    setToken(null);
  }, []);

  // Сервер ответил 401 на запрос с токеном: выходим, кабинет перенаправит на вход.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      writeToken(null);
      setToken(null);
      setExpired(true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const value = useMemo(() => ({ token, expired, signIn, signOut }), [token, expired, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession: нет SessionProvider');
  return v;
}
