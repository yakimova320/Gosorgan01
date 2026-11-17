import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/*
 * Сессия: только токен и признак «сессия истекла».
 * Токен хранится в localStorage браузера (ТЗ v2: Bearer-токен).
 * Минус: скрипт на странице может его прочитать, поэтому сайт не вставляет чужой HTML (ответы модели выводятся как текст).
 */

const KEY = 'jasno.session';

export function readStoredToken(): string | null {
  try {
    return typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function writeStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // Браузер запретил хранение (приватный режим): сессия живёт до перезагрузки страницы.
  }
}

export interface SessionState {
  token: string | null;
  /** true: сервер отклонил сессию (истекла), экран входа показывает пояснение */
  expired: boolean;
}

const sessionSlice = createSlice({
  name: 'session',
  initialState: (): SessionState => ({
    token: readStoredToken(),
    expired: false,
  }),
  reducers: {
    signedIn: (_state, action: PayloadAction<string>) => ({
      token: action.payload,
      expired: false,
    }),
    signedOut: () => ({ token: null, expired: false }),
    /** 401 на запросе с текущим токеном */
    sessionExpired: () => ({ token: null, expired: true }),
  },
});

export const { signedIn, signedOut, sessionExpired } = sessionSlice.actions;
export const sessionReducer = sessionSlice.reducer;
