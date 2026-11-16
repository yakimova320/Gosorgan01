import { MOCK_CABINET, MOCK_CASES, mockUploadLetter } from '../mocks/data';
import { DATA_MODE } from './config';
import { ApiClientError, messageFor } from './errors';
import { request } from './http';
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
} from './types';

/*
 * Все обращения сайта к данным идут через этот файл.
 * mock: примерные данные (mocks/data.ts), сервер не нужен.
 * api: настоящий сервер. Операции, у которых на сервере ещё нет эндпоинта, бросают NOT_CONNECTED,
 * экран показывает честное «ещё не подключено» и не делает вид, что сохранил.
 */

const wait = (ms = 350): Promise<void> => new Promise<void>((r) => setTimeout(r, ms));
const notConnected = (): never => {
  throw new ApiClientError('NOT_CONNECTED', messageFor('NOT_CONNECTED'));
};
const notFound = (): never => {
  throw new ApiClientError('NOT_FOUND', messageFor('NOT_FOUND'), 404);
};

function summary(c: CaseDetail): CaseSummary {
  const { letters: _l, claims: _c, deadlines: _d, drafts: _dr, timeline: _t, ...rest } = c;
  return rest;
}

export const api = {
  mode: DATA_MODE,

  async health(): Promise<Health> {
    if (DATA_MODE === 'mock') return { ok: true, llmMode: 'demo', version: 'mock' };
    return request<Health>('GET', '/health');
  },

  // ---------- Регистрация и вход (B03) ----------

  async register(input: { email: string; password: string; consent: boolean }): Promise<{ sessionToken: string }> {
    if (DATA_MODE === 'mock') {
      await wait();
      return { sessionToken: 'mock-session' };
    }
    return request('POST', '/auth/register', { body: input });
  },

  async login(input: { email: string; password: string }): Promise<{ sessionToken: string }> {
    if (DATA_MODE === 'mock') {
      await wait();
      return { sessionToken: 'mock-session' };
    }
    return request('POST', '/auth/login', { body: input });
  },

  async logout(token: string | null): Promise<void> {
    if (DATA_MODE === 'mock' || !token) return;
    await request<void>('POST', '/auth/logout', { token });
  },

  async forgotPassword(email: string): Promise<void> {
    if (DATA_MODE === 'mock') return wait();
    await request<void>('POST', '/auth/password/forgot', { body: { email } });
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (DATA_MODE === 'mock') return wait();
    await request<void>('POST', '/auth/password/reset', { body: { token, newPassword } });
  },

  async changePassword(token: string | null, oldPassword: string, newPassword: string): Promise<void> {
    if (DATA_MODE === 'mock') return wait();
    await request<void>('POST', '/auth/password/change', { token, body: { oldPassword, newPassword } });
  },

  async deleteAccount(token: string | null, password: string): Promise<void> {
    if (DATA_MODE === 'mock') return wait();
    await request<void>('DELETE', '/cabinet', { token, body: { password } });
  },

  async cabinet(token: string | null): Promise<Cabinet> {
    if (DATA_MODE === 'mock') return MOCK_CABINET;
    return request<Cabinet>('GET', '/cabinet', { token });
  },

  // ---------- Письма и факты (B05, B06) ----------

  async uploadLetter(_token: string | null, files: File[]): Promise<UploadResult> {
    if (DATA_MODE === 'mock') {
      await wait(1800);
      const letter = mockUploadLetter();
      return {
        letter,
        claims: letter.claims,
        deadlines: letter.deadlines,
        suggestions: [{ caseId: 'case-jc', title: 'Jobcenter: выписки со счёта', reason: 'Совпадает номер дела JC-2026-1001' }],
      };
    }
    void files;
    return notConnected();
  },

  // ---------- Дела (B07) ----------

  async cases(_token: string | null): Promise<CaseSummary[]> {
    if (DATA_MODE === 'mock') return MOCK_CASES.map(summary);
    return notConnected();
  },

  async caseDetail(_token: string | null, id: string): Promise<CaseDetail> {
    if (DATA_MODE === 'mock') return MOCK_CASES.find((c) => c.id === id) ?? notFound();
    return notConnected();
  },

  async history(_token: string | null): Promise<HistoryItem[]> {
    if (DATA_MODE === 'mock') {
      return MOCK_CASES.flatMap((c) => c.timeline.map((t) => ({ ...t, caseId: c.id, caseTitle: c.title }))).sort((a, b) =>
        b.at.localeCompare(a.at),
      );
    }
    return notConnected();
  },

  // ---------- Объяснение и черновик (B08, B10) ----------

  async explain(_token: string | null, letterId: string): Promise<Explanation> {
    if (DATA_MODE === 'mock') {
      await wait(900);
      const letter = MOCK_CASES.flatMap((c) => c.letters).find((l) => l.id === letterId);
      if (letter?.explanation) return letter.explanation;
      throw new ApiClientError('DATES_NOT_VERIFIED', messageFor('DATES_NOT_VERIFIED'), 422);
    }
    return notConnected();
  },

  async draft(_token: string | null, caseId: string, kind: DraftKind, _question: string): Promise<Draft> {
    if (DATA_MODE === 'mock') {
      await wait(900);
      const found = MOCK_CASES.find((c) => c.id === caseId)?.drafts[0];
      if (!found) throw new ApiClientError('NO_CONFIRMED_CLAIMS', messageFor('NO_CONFIRMED_CLAIMS'), 409);
      return { ...found, kind };
    }
    return notConnected();
  },
};
