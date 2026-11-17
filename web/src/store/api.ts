import { createApi } from '@reduxjs/toolkit/query/react';
import { MOCK_CABINET, MOCK_CASES } from '../mocks/data';
import {
  mockCreateDraft,
  mockDraftQuestions,
  mockGetDraft,
  mockCaseDetail,
  mockCaseLetter,
  mockDeleteCase,
  mockExplanation,
  mockHistory,
  mockSetCaseStatus,
} from '../mocks/cases';
import {
  mockAssign,
  mockConfirm,
  mockCorrect,
  mockDelete,
  mockLetter,
  mockLetters,
  mockUpload,
} from '../mocks/letters';
import { DATA_MODE } from '../api/config';
import { apiError, type ApiError } from '../api/errors';
import type {
  ApiCaseDetail,
  ApiDraft,
  ApiExplanation,
  DraftQuestions,
  QuestionId,
  Cabinet,
  CaseDetail,
  CaseSummary,
  Health,
  HistoryGroup,
  HistoryPageResult,
  LetterDetail,
  UploadResponse,
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
/** Загрузка фото: распознавание и извлечение фактов могут идти больше минуты. */
const UPLOAD_TIMEOUT_MS = 180_000;

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

/** Письмо во входящих (GET /letters?inbox=true). */
export interface InboxLetter {
  id: string;
  createdAt: string;
  sourceType: 'PDF_TEXT' | 'IMAGE';
  authority: string | null;
  caseNumber: string | null;
  unconfirmed: number;
}

export const api = createApi({
  reducerPath: 'api',
  baseQuery: apiBaseQuery,
  tagTypes: ['Cabinet', 'Case', 'History', 'Letters', 'Letter'],
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
      {
        email: string;
        password: string;
        consent: boolean;
        firstName: string;
        lastName: string;
        address: string;
      }
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

    // STUB: эндпоинтов пароля и удаления аккаунта на сервере ещё нет (A01–A03).
    // В режиме api честно отвечаем NOT_CONNECTED; подключение: задачи A01, A02, A03.
    forgotPassword: b.mutation<void, string>({
      queryFn: async () => {
        if (isMock) return wait().then(() => ok(undefined));
        return notConnected();
      },
    }),

    resetPassword: b.mutation<void, { token: string; newPassword: string }>({
      queryFn: async () => {
        if (isMock) return wait().then(() => ok(undefined));
        return notConnected();
      },
    }),

    changePassword: b.mutation<
      void,
      { oldPassword: string; newPassword: string }
    >({
      queryFn: async () => {
        if (isMock) return wait().then(() => ok(undefined));
        return notConnected();
      },
    }),

    deleteAccount: b.mutation<void, string>({
      queryFn: async () => {
        if (isMock) return wait().then(() => ok(undefined));
        return notConnected();
      },
    }),

    cabinet: b.query<Cabinet, void>({
      queryFn: (_a, _api, _x, base) =>
        isMock
          ? ok(MOCK_CABINET)
          : (base({ path: '/cabinet' }) as Promise<Result<Cabinet>>),
      providesTags: ['Cabinet'],
    }),

    /** Изменение профиля: только изменённые поля, сервер проверяет итог целиком. */
    updateProfile: b.mutation<
      Cabinet,
      Partial<NonNullable<Cabinet['profile']>>
    >({
      queryFn: async (profile, _api, _x, base) => {
        if (isMock) {
          await wait();
          return ok({
            ...MOCK_CABINET,
            profile: { ...MOCK_CABINET.profile, ...profile },
          });
        }
        return base({
          method: 'PATCH',
          path: '/cabinet',
          body: { profile },
        }) as Promise<Result<Cabinet>>;
      },
      invalidatesTags: ['Cabinet'],
    }),

    // ---------- Письма и факты (B05, B06) ----------

    /** Входящие письма кабинета (без дела). В режиме mock: пусто, примерные письма лежат в делах. */
    letters: b.query<InboxLetter[], void>({
      queryFn: (_a, _api, _x, base) =>
        isMock
          ? ok<InboxLetter[]>(
              mockLetters().map((l) => ({
                id: l.letter.id,
                createdAt: l.letter.createdAt,
                sourceType: l.letter.sourceType,
                authority:
                  l.claims.find((c) => c.kind === 'AUTHORITY')?.value ?? null,
                caseNumber:
                  l.claims.find((c) => c.kind === 'CASE_NUMBER')?.value ?? null,
                unconfirmed: l.claims.filter((c) => c.status === 'UNCONFIRMED')
                  .length,
              })),
            )
          : (base({ path: '/letters?inbox=true' }) as Promise<
              Result<InboxLetter[]>
            >),
      providesTags: ['Letters'],
    }),

    /**
     * Загрузка письма (B05, B06). Аргумент: ключ файлов из uploads.ts, сами File в Redux не попадают.
     * Тайм-аут больше обычного: фото + извлечение фактов. Автоматического повтора нет:
     * после тайм-аута письмо могло сохраниться.
     */
    uploadLetter: b.mutation<UploadResponse, string>({
      queryFn: async (uploadKey, _api, _x, base) => {
        const files = takeUploadFiles(uploadKey);
        if (isMock) {
          await wait(1800);
          return ok(mockUpload());
        }
        const form = new FormData();
        for (const f of files) form.append('files', f, f.name);
        return base({
          method: 'POST',
          path: '/letters',
          form,
          timeoutMs: UPLOAD_TIMEOUT_MS,
        }) as Promise<Result<UploadResponse>>;
      },
      invalidatesTags: ['Cabinet', 'Letters'],
    }),

    letter: b.query<LetterDetail, string>({
      queryFn: (id, _api, _x, base) => {
        if (isMock) {
          const fromCase = mockCaseLetter(id);
          if (fromCase) return ok(fromCase);
          const r = mockLetter(id);
          return 'code' in r ? { error: r } : ok(r);
        }
        return base({ path: `/letters/${encodeURIComponent(id)}` }) as Promise<
          Result<LetterDetail>
        >;
      },
      providesTags: (_r, _e, id) => [{ type: 'Letter', id }],
    }),

    /** «Сохранить проверку»: все решения одним запросом. */
    confirmClaims: b.mutation<
      LetterDetail,
      { id: string; confirm: string[]; reject: string[] }
    >({
      queryFn: ({ id, confirm, reject }, _api, _x, base) => {
        if (isMock) {
          const r = mockConfirm(id, confirm, reject);
          return 'code' in r ? { error: r } : ok(r);
        }
        return base({
          method: 'POST',
          path: `/letters/${encodeURIComponent(id)}/claims/confirm`,
          body: { confirm, reject },
        }) as Promise<Result<LetterDetail>>;
      },
      invalidatesTags: (_r, _e, a) => [
        { type: 'Letter', id: a.id },
        'Letters',
        'Cabinet',
      ],
    }),

    correctClaim: b.mutation<
      LetterDetail,
      { id: string; claimId: string; value: string }
    >({
      queryFn: ({ id, claimId, value }, _api, _x, base) => {
        if (isMock) {
          const r = mockCorrect(id, claimId, value);
          return 'code' in r ? { error: r } : ok(r);
        }
        return base({
          method: 'POST',
          path: `/letters/${encodeURIComponent(id)}/claims/${encodeURIComponent(claimId)}/correct`,
          body: { value },
        }) as Promise<Result<LetterDetail>>;
      },
      invalidatesTags: (_r, _e, a) => [
        { type: 'Letter', id: a.id },
        'Letters',
        'Cabinet',
      ],
    }),

    /** Полное удаление письма. «Оставить во входящих» запроса не требует: письмо уже во входящих. */
    /** «В дело»: существующее дело или новое. Факты и сроки переходят вместе с письмом. */
    assignLetter: b.mutation<
      { caseId: string; changed: boolean },
      {
        id: string;
        target: { caseId: string } | { newCase: { title?: string } };
      }
    >({
      queryFn: ({ id, target }, _api, _x, base) => {
        if (isMock) {
          const r = mockAssign(
            id,
            'caseId' in target ? target.caseId : 'case-jc',
          );
          return 'code' in r ? { error: r } : ok(r);
        }
        return base({
          method: 'POST',
          path: `/letters/${encodeURIComponent(id)}/assign`,
          body: target,
        }) as Promise<Result<{ caseId: string; changed: boolean }>>;
      },
      invalidatesTags: (_r, _e, a) => [
        { type: 'Letter', id: a.id },
        'Letters',
        'Cabinet',
        { type: 'Case', id: 'LIST' },
      ],
    }),

    deleteLetter: b.mutation<void, string>({
      queryFn: async (id, _api, _x, base) => {
        if (isMock) return ok(mockDelete(id));
        return base({
          method: 'DELETE',
          path: `/letters/${encodeURIComponent(id)}`,
        }) as Promise<Result<void>>;
      },
      invalidatesTags: ['Letters', 'Cabinet'],
    }),

    // ---------- Дела (B07) ----------

    cases: b.query<CaseSummary[], void>({
      queryFn: (_a, _api, _x, base) =>
        isMock
          ? ok(MOCK_CASES.map(summary))
          : (base({ path: '/cases?status=all' }) as Promise<
              Result<CaseSummary[]>
            >),
      providesTags: [{ type: 'Case', id: 'LIST' }],
    }),

    /** Дело (B07). Не храним после ухода с экрана: после удаления данных дела в кэше не остаётся. */
    caseDetail: b.query<ApiCaseDetail, string>({
      queryFn: (id, _api, _x, base) => {
        if (isMock) {
          const r = mockCaseDetail(id);
          return 'code' in r ? { error: r } : ok(r);
        }
        return base({ path: `/cases/${encodeURIComponent(id)}` }) as Promise<
          Result<ApiCaseDetail>
        >;
      },
      keepUnusedDataFor: 0,
      providesTags: (_r, _e, id) => [{ type: 'Case', id }],
    }),

    updateCase: b.mutation<
      ApiCaseDetail,
      { id: string; status?: 'OPEN' | 'CLOSED'; title?: string }
    >({
      queryFn: ({ id, ...body }, _api, _x, base) => {
        if (isMock) {
          const r = mockSetCaseStatus(id, body.status ?? 'OPEN');
          return 'code' in r ? { error: r } : ok(r);
        }
        return base({
          method: 'PATCH',
          path: `/cases/${encodeURIComponent(id)}`,
          body,
        }) as Promise<Result<ApiCaseDetail>>;
      },
      invalidatesTags: (_r, _e, a) => [
        { type: 'Case', id: a.id },
        { type: 'Case', id: 'LIST' },
        'Cabinet',
        'History',
      ],
    }),

    deleteCase: b.mutation<void, string>({
      queryFn: async (id, _api, _x, base) => {
        if (isMock) {
          const r = mockDeleteCase(id);
          return r ? { error: r } : ok(undefined);
        }
        return base({
          method: 'DELETE',
          path: `/cases/${encodeURIComponent(id)}`,
        }) as Promise<Result<void>>;
      },
      invalidatesTags: [
        { type: 'Case', id: 'LIST' },
        'Cabinet',
        'History',
        'Letters',
        'Letter',
      ],
    }),

    /**
     * История одной страницей (GET /history). Страницы собирает экран; при смене фильтра он начинает заново.
     * Группы → типы событий API: letter (письмо получено, дело создано, факты подтверждены и отклонены,
     * изменения), question (вопросы по делу), draft (черновик подготовлен и отправлен, «Я отправил(а)»).
     */
    historyPage: b.query<
      HistoryPageResult,
      { type?: HistoryGroup; cursor?: string }
    >({
      queryFn: ({ type, cursor }, _api, _x, base) => {
        if (isMock) return ok(mockHistory(type));
        const q = new URLSearchParams();
        if (type) q.set('type', type);
        if (cursor) q.set('cursor', cursor);
        const qs = q.toString();
        return base({ path: `/history${qs ? `?${qs}` : ''}` }) as Promise<
          Result<HistoryPageResult>
        >;
      },
      keepUnusedDataFor: 0,
      providesTags: ['History'],
    }),

    /**
     * Объяснение (B08). Запрос — только при открытии экрана или по кнопке, не в фоне после изменения фактов:
     * у этого запроса нет тегов, изменения фактов его не перезапускают. Сервер отдаёт кэш, если факты не менялись.
     */
    explanation: b.query<ApiExplanation, string>({
      queryFn: async (letterId, _api, _x, base) => {
        if (isMock) {
          await wait(600);
          const r = mockExplanation(letterId);
          return 'code' in r ? { error: r } : ok(r);
        }
        return base({
          method: 'POST',
          path: `/letters/${encodeURIComponent(letterId)}/explain?lang=ru`,
          timeoutMs: UPLOAD_TIMEOUT_MS,
        }) as Promise<Result<ApiExplanation>>;
      },
      keepUnusedDataFor: 0,
    }),

    /** Доступные готовые вопросы для письма дела (B10). После ошибок экран запрашивает их заново. */
    draftQuestions: b.query<DraftQuestions, string>({
      queryFn: (letterId, _api, _x, base) => {
        if (isMock) {
          const r = mockDraftQuestions(letterId);
          return 'code' in r ? { error: r } : ok(r);
        }
        return base({
          path: `/letters/${encodeURIComponent(letterId)}/draft-questions`,
        }) as Promise<Result<DraftQuestions>>;
      },
      keepUnusedDataFor: 0,
    }),

    /** Собрать черновик. Один запрос на нажатие, без автоматического повтора. */
    createDraft: b.mutation<
      ApiDraft,
      {
        caseId: string;
        letterId: string;
        questionId: QuestionId;
        amountClaimId?: string;
      }
    >({
      queryFn: ({ caseId, ...body }, _api, _x, base) => {
        if (isMock) {
          const r = mockCreateDraft(caseId, body.letterId, body.questionId);
          return 'code' in r ? { error: r } : ok(r);
        }
        return base({
          method: 'POST',
          path: `/cases/${encodeURIComponent(caseId)}/draft`,
          body: { kind: 'CLARIFICATION', ...body },
        }) as Promise<Result<ApiDraft>>;
      },
      invalidatesTags: (_r, _e, a) => [
        { type: 'Case', id: a.caseId },
        { type: 'Case', id: 'LIST' },
        'History',
      ],
    }),

    /** Черновик (текст, основания-снимок, stale). Перед копированием экран запрашивает его заново. */
    draft: b.query<ApiDraft, string>({
      queryFn: (id, _api, _x, base) => {
        if (isMock) {
          const r = mockGetDraft(id);
          return 'code' in r ? { error: r } : ok(r);
        }
        return base({ path: `/drafts/${encodeURIComponent(id)}` }) as Promise<
          Result<ApiDraft>
        >;
      },
      keepUnusedDataFor: 0,
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
  useLazyHistoryPageQuery,
  useExplanationQuery,
  useUpdateCaseMutation,
  useDeleteCaseMutation,
  useDraftQuery,
  useDraftQuestionsQuery,
  useCreateDraftMutation,
  useLettersQuery,
  useLetterQuery,
  useConfirmClaimsMutation,
  useCorrectClaimMutation,
  useDeleteLetterMutation,
  useAssignLetterMutation,
  useUpdateProfileMutation,
} = api;
