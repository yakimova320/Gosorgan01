import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStore } from './index';
import { api } from './api';
import { abortAllRequests, apiBaseQuery, type RequestArgs } from './baseQuery';
import { sessionExpired, signedIn, type SessionState } from './session';

/** Минимальный BaseQueryApi для вызова baseQuery без store. */
function fakeApi(state: { session: SessionState }) {
  const dispatch = vi.fn();
  return {
    dispatch,
    api: {
      getState: () => state,
      dispatch,
      signal: new AbortController().signal,
      abort: () => undefined,
      extra: undefined,
      endpoint: 'test',
      type: 'query' as const,
    },
  };
}

function respond(status: number, body?: unknown) {
  return new Response(
    body === undefined
      ? null
      : typeof body === 'string'
        ? body
        : JSON.stringify(body),
    { status },
  );
}

const run = (args: RequestArgs, a: ReturnType<typeof fakeApi>['api']) =>
  apiBaseQuery(args, a as never, {});

afterEach(() => vi.unstubAllGlobals());

describe('apiBaseQuery', () => {
  it('204: данные undefined, JSON не разбирается', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(204)));
    const { api: a } = fakeApi({ session: { token: 't', expired: false } });
    expect(await run({ path: '/x' }, a)).toEqual({ data: undefined });
  });

  it('ставит Bearer-токен и отправляет JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const { api: a } = fakeApi({ session: { token: 'tok', expired: false } });
    await run({ method: 'POST', path: '/x', body: { a: 1 } }, a);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok',
    );
    expect(init.body).toBe('{"a":1}');
  });

  it('FormData уходит без Content-Type JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, {}));
    vi.stubGlobal('fetch', fetchMock);
    const { api: a } = fakeApi({ session: { token: null, expired: false } });
    const form = new FormData();
    await run({ method: 'POST', path: '/x', form }, a);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(form);
    expect(
      (init.headers as Record<string, string>)['Content-Type'],
    ).toBeUndefined();
  });

  it('ошибка сервера: обычный объект { code, message, status, details }', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respond(409, {
            code: 'EMAIL_TAKEN',
            message: 'Занят',
            details: { f: 1 },
          }),
        ),
    );
    const { api: a } = fakeApi({ session: { token: null, expired: false } });
    const r = (await run({ path: '/x' }, a)) as { error: object };
    expect(r.error).toEqual({
      code: 'EMAIL_TAKEN',
      message: 'Занят',
      status: 409,
      details: { f: 1 },
    });
    expect(Object.getPrototypeOf(r.error)).toBe(Object.prototype);
  });

  it('непонятный ответ: BAD_RESPONSE; нет сети: NETWORK', async () => {
    const { api: a } = fakeApi({ session: { token: null, expired: false } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(200, '<html>')));
    expect(
      ((await run({ path: '/x' }, a)) as { error: { code: string } }).error
        .code,
    ).toBe('BAD_RESPONSE');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    expect(
      ((await run({ path: '/x' }, a)) as { error: { code: string } }).error
        .code,
    ).toBe('NETWORK');
  });

  it('тайм-аут: TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_r, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new Error('abort')),
            ),
          ),
      ),
    );
    const { api: a } = fakeApi({ session: { token: null, expired: false } });
    expect(
      (
        (await run({ path: '/x', timeoutMs: 10 }, a)) as {
          error: { code: string };
        }
      ).error.code,
    ).toBe('TIMEOUT');
  });

  it('401 INVALID_CREDENTIALS при входе не завершает сессию', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respond(401, { code: 'INVALID_CREDENTIALS', message: 'Неверно' }),
        ),
    );
    const f = fakeApi({ session: { token: 'old', expired: false } });
    await run({ method: 'POST', path: '/auth/login', auth: false }, f.api);
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('401 UNAUTHORIZED с текущим токеном завершает сессию', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respond(401, { code: 'UNAUTHORIZED', message: 'Войдите' }),
        ),
    );
    const f = fakeApi({ session: { token: 'A', expired: false } });
    await run({ path: '/cabinet' }, f.api);
    expect(f.dispatch).toHaveBeenCalledWith(sessionExpired());
  });

  it('запоздалый 401 от старой сессии не завершает новую', async () => {
    const state = { session: { token: 'A', expired: false } as SessionState };
    let answer!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (answer = r))),
    );
    const f = fakeApi(state);
    const pending = run({ path: '/cabinet' }, f.api);
    state.session = { token: 'B', expired: false }; // вошёл другой пользователь
    answer(respond(401, { code: 'UNAUTHORIZED', message: 'Войдите' }));
    await pending;
    expect(f.dispatch).not.toHaveBeenCalled();
  });

  it('abortAllRequests отменяет незавершённые запросы', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_u: string, init: RequestInit) =>
          new Promise((_r, reject) =>
            init.signal?.addEventListener('abort', () =>
              reject(new Error('abort')),
            ),
          ),
      ),
    );
    const { api: a } = fakeApi({ session: { token: 'A', expired: false } });
    const pending = run({ path: '/cabinet' }, a);
    abortAllRequests();
    expect(((await pending) as { error: { code: string } }).error.code).toBe(
      'CANCELLED',
    );
  });
});

describe('store: смена пользователя', () => {
  it('вход другого пользователя очищает кэш RTK Query', async () => {
    const store = createStore({ token: 'A', expired: false });
    await store.dispatch(api.endpoints.cabinet.initiate()); // режим mock в тестах
    expect(Object.keys(store.getState().api.queries)).not.toHaveLength(0);
    store.dispatch(signedIn('B'));
    expect(store.getState().api.queries).toEqual({});
    expect(store.getState().session).toEqual({ token: 'B', expired: false });
  });
});
