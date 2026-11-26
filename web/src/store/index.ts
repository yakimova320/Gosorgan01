import {
  configureStore,
  createListenerMiddleware,
  isAnyOf,
} from '@reduxjs/toolkit';
import { useDispatch, useSelector } from 'react-redux';
import { api } from './api';
import { abortAllRequests } from './baseQuery';
import {
  sessionExpired,
  sessionReducer,
  signedIn,
  signedOut,
  writeStoredToken,
  type SessionState,
} from './session';
import { clearUploadFiles } from './uploads';
import { keyring, lockKeyring } from '../crypto/keyring';

/*
 * Store сайта: session (slice) и api (кэш RTK Query).
 * При входе, выходе и истечении сессии: отменить незавершённые запросы,
 * очистить кэш и файлы, сохранить токен. Данные прошлого пользователя не остаются.
 */

export function createStore(preloadedSession?: SessionState) {
  const listener = createListenerMiddleware();
  listener.startListening({
    matcher: isAnyOf(signedIn, signedOut, sessionExpired),
    effect: (action, { dispatch, getState }) => {
      abortAllRequests();
      clearUploadFiles();
      // E01: ключи архива только в памяти; при смене или конце сессии стираются
      lockKeyring();
      dispatch(api.util.resetApiState());
      writeStoredToken((getState() as { session: SessionState }).session.token);
      void action;
    },
  });

  const store = configureStore({
    reducer: { session: sessionReducer, [api.reducerPath]: api.reducer },
    preloadedState: preloadedSession
      ? { session: preloadedSession }
      : undefined,
    middleware: (gdm) =>
      gdm().prepend(listener.middleware).concat(api.middleware),
  });
  keyring.configure({ getToken: () => store.getState().session.token });
  return store;
}

export type AppStore = ReturnType<typeof createStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

export const useSession = () => useAppSelector((s) => s.session);
