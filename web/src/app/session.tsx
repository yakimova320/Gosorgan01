import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

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
  signIn: (token: string) => void;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children, initialToken }: { children: ReactNode; initialToken?: string | null }) {
  const [token, setToken] = useState<string | null>(() => (initialToken !== undefined ? initialToken : readToken()));

  const signIn = useCallback((t: string) => {
    writeToken(t);
    setToken(t);
  }, []);

  const signOut = useCallback(() => {
    writeToken(null);
    setToken(null);
  }, []);

  const value = useMemo(() => ({ token, signIn, signOut }), [token, signIn, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession: нет SessionProvider');
  return v;
}
