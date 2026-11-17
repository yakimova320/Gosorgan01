import { createApi } from '@reduxjs/toolkit/query/react';
import { MOCK_CABINET, MOCK_CASES, mockUploadLetter } from '../mocks/data';
import { DATA_MODE } from '../api/config';
import { apiError, type ApiError } from '../api/errors';
import type {
  Cabinet,
  CaseDetail,
  CaseSummary,
  Draft,
  DraftKind,
  Explanation,
  Health,
  HistoryItem,
  UploadResult,
} from '../api/types';
import { apiBaseQuery, type RequestArgs } from './baseQuery';
import { takeUploadFiles } from './uploads';

/*
 * Все обращения сайта к данным идут через RTK Query (TechBriefing v5, раздел 4).
 * Данные с сервера живут только в этом кэше, в slices их не копируем.
 * mock: примерные данные (mocks/data.ts), сервер не нужен.
 * api: настоящий сервер. Эндпоинты, которых на сервере ещё нет, отвечают NOT_CONNECTED:
 * экран честно говорит «ещё не подключено» и не делает вид, что сохранил.
 */

type Result<T> = { data: T } | { error: ApiError };

const wait = (ms = 350): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));
const ok = <T>(data: T): Result<T> => ({ data });
const fail = (code: string, status?: number): { error: ApiError } => ({
  error: apiError(code, status),
});
const notConnected = () => fail('NOT_CONNECTED');
const isMock = DATA_MODE === 'mock';

function summary(c: CaseDetail): CaseSummary {
  const {
    letters: _l,
    claims: _c,
    deadlines: _d,
    drafts: _dr,
    timeline: _t,
    ...rest
  } = c;
  return rest;
}

export const api = createApi({
  reducerPath: 'api',
  baseQuery: apiBaseQuery,
  tagTypes: ['Cabinet', 'Case', 'History'],
  endpoints: (b) => ({
    health: b.query<Health, void>({
      queryFn: (_a, _api, _x, base) =>
        isMock
          ? ok<Health>({ ok: true, llmMode: 'demo', version: 'mock' })
          : (base({ path: '/health', auth: false }) as Promise<Result<Health>>),
    }),

    // ---------- Регистрация и вход (B03) ----------

    register: b.mutation<
      { sessionToken: string },
      { email: string; password: string; consent: boolean }
    >({
      queryFn: async (body, _api, _x, base) => {
        if (isMock)
          return wait().then(() => ok({ sessionToken: 'mock-session' }));
        return base({
          method: 'POST',
          path: '/auth/register',
          body,
          auth: false,
        }) as Promise<Result<{ sessionToken: string }>>;
      },
    }),

    login: b.mutation<
      { sessionToken: string },
      { email: string; password: string }
    >({
      queryFn: async (body, _api, _x, base) => {
        if (isMock)
          return wait().then(() => ok({ sessionToken: 'mock-session' }));
        return base({
          method: 'POST',
          path: '/auth/login',
          body,
          auth: false,
        }) as Promise<Result<{ sessionToken: string }>>;
      },
    }),

    logout: b.mutation<void, void>({
      queryFn: async (_a, _api, _x, base) => {
        if (isMock) return ok(undefined);
        return base({ method: 'POST', path: '/auth/logout' }) as Promise<
          Result<void>
        >;
      },
    }),

    forgotPassword: b.mutation<void, string>({
      queryFn: async (email, _api, _x, base) => {
        if (isMock) return wait().then(() => ok(undefined));
        return base({
          method: 'POST',
          path: '/auth/password/forgot',
          body: { email },
          auth: false,
        }) as Promise<Result<void>>;
      },
    }),

    resetPassword: b.mutation<void, { token: string; newPassword: string }>({
      queryFn: async (body, _api, _x, base) => {
        if (isMock) return wait().then(() => ok(undefined));
        return base({
          method: 'POST',
          path: '/auth/password/reset',
          body,
          auth: false,
        }) as Promise<Result<void>>;
      },
    }),

    changePassword: b.mutation<
      void,
      { oldPassword: string; newPassword: string }
    >({
      queryFn: async (body, _api, _x, base) => {
        if (isMock) return wait().then(() => ok(undefined));
        return base({
          method: 'POST',
          path: '/auth/password/change',
          body,
        }) as Promise<Result<void>>;
      },
    }),

    deleteAccount: b.mutation<void, string>({
      queryFn: async (password, _api, _x, base) => {
        if (isMock) return wait().then(() => ok(undefined));
        return base({
          method: 'DELETE',
          path: '/cabinet',
          body: { password },
        }) as Promise<Result<void>>;
      },
    }),

    cabinet: b.query<Cabinet, void>({
      queryFn: (_a, _api, _x, base) =>
        isMock
          ? ok(MOCK_CABINET)
          : (base({ path: '/cabinet' }) as Promise<Result<Cabinet>>),
      providesTags: ['Cabinet'],
    }),

    // ---------- Письма и факты (B05, B06) ----------

    /** Аргумент: ключ файлов из uploads.ts. Сами File в Redux не попадают. */
    uploadLetter: b.mutation<UploadResult, string>({
      queryFn: async (uploadKey) => {
        const files = takeUploadFiles(uploadKey);
        if (!isMock) return notConnected();
        void files;
        await wait(1800);
        const letter = mockUploadLetter();
        return ok<UploadResult>({
          letter,
          claims: letter.claims,
          deadlines: letter.deadlines,
          suggestions: [
            {
              caseId: 'case-jc',
              title: 'Jobcenter: выписки со счёта',
              reason: 'Совпадает номер дела JC-2026-1001',
            },
          ],
        });
      },
      invalidatesTags: ['Cabinet', 'Case', 'History'],
    }),

    // ---------- Дела (B07) ----------

    cases: b.query<CaseSummary[], void>({
      queryFn: () => (isMock ? ok(MOCK_CASES.map(summary)) : notConnected()),
      providesTags: [{ type: 'Case', id: 'LIST' }],
    }),

    caseDetail: b.query<CaseDetail, string>({
      queryFn: (id) => {
        if (!isMock) return notConnected();
        const found = MOCK_CASES.find((c) => c.id === id);
        return found ? ok(found) : fail('NOT_FOUND', 404);
      },
      providesTags: (_r, _e, id) => [{ type: 'Case', id }],
    }),

    history: b.query<HistoryItem[], void>({
      queryFn: () =>
        isMock
          ? ok(
              MOCK_CASES.flatMap((c) =>
                c.timeline.map((t) => ({
                  ...t,
                  caseId: c.id,
                  caseTitle: c.title,
                })),
              ).sort((a, b) => b.at.localeCompare(a.at)),
            )
          : notConnected(),
      providesTags: ['History'],
    }),

    // ---------- Объяснение и черновик (B08, B10) ----------

    explain: b.query<Explanation, string>({
      queryFn: async (letterId) => {
        if (!isMock) return notConnected();
        await wait(900);
        const letter = MOCK_CASES.flatMap((c) => c.letters).find(
          (l) => l.id === letterId,
        );
        return letter?.explanation
          ? ok(letter.explanation)
          : fail('DATES_NOT_VERIFIED', 422);
      },
    }),

    draft: b.query<
      Draft,
      { caseId: string; kind: DraftKind; question: string }
    >({
      queryFn: async ({ caseId, kind }) => {
        if (!isMock) return notConnected();
        await wait(900);
        const found = MOCK_CASES.find((c) => c.id === caseId)?.drafts[0];
        return found
          ? ok({ ...found, kind })
          : fail('NO_CONFIRMED_CLAIMS', 409);
      },
      providesTags: (_r, _e, a) => [{ type: 'Case', id: a.caseId }],
    }),
  }),
});

export type { RequestArgs };

export const {
  useHealthQuery,
  useRegisterMutation,
  useLoginMutation,
  useLogoutMutation,
  useForgotPasswordMutation,
  useResetPasswordMutation,
  useChangePasswordMutation,
  useDeleteAccountMutation,
  useCabinetQuery,
  useUploadLetterMutation,
  useCasesQuery,
  useCaseDetailQuery,
  useHistoryQuery,
  useExplainQuery,
  useDraftQuery,
} = api;
