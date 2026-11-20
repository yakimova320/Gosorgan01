import { apiError, type ApiError } from '../api/errors';
import type {
  ApiCaseDetail,
  ApiDraft,
  CreateDraftArgs,
  DraftQuestions,
  QuestionId,
  ApiExplanation,
  ApiHistoryItem,
  HistoryGroup,
  HistoryPageResult,
  LetterClaim,
  LetterDetail,
} from '../api/types';
import { MOCK_CASES } from './data';

/*
 * Примерные дела (режим mock, офлайн-показ) в формате ответов API B07 и B08.
 * Данные только в памяти страницы.
 */

const claimOf = (c: {
  id: string;
  kind: LetterClaim['kind'];
  value: string;
  text: string;
  quote: string | null;
  page: number | null;
  basis: LetterClaim['basis'];
  status: string;
}): LetterClaim => ({
  ...c,
  status:
    c.status === 'SUPERSEDED'
      ? 'REJECTED'
      : (c.status as LetterClaim['status']),
  supersedesId: null,
  relativeDeadline: false,
});

const closed = new Set<string>();
const deleted = new Set<string>();

export function mockCaseDetail(id: string): ApiCaseDetail | ApiError {
  const c = MOCK_CASES.find((x) => x.id === id);
  if (!c || deleted.has(id)) return apiError('NOT_FOUND', 404);
  const confirmed = new Set(
    c.claims.filter((x) => x.status === 'CONFIRMED').map((x) => x.id),
  );
  return {
    ...c,
    stage: closed.has(id) ? 'CLOSED' : c.stage,
    status: closed.has(id) ? 'CLOSED' : 'OPEN',
    letters: c.letters.map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      sourceType: l.sourceType,
      authority: c.authority,
      unconfirmed: l.claims.filter((x) => x.status === 'UNCONFIRMED').length,
    })),
    claims: c.claims.map(claimOf),
    deadlines: c.deadlines.map((d) => ({
      id: d.id,
      claimId: d.claimId,
      date: d.date,
      kind: d.kind,
      active: confirmed.has(d.claimId),
      done: d.doneAt !== null,
    })),
    drafts: c.drafts.map((d) => ({
      id: d.id,
      kind: d.kind,
      status: d.status,
      stale: d.stale,
      createdAt: d.createdAt,
    })),
    timeline: c.timeline.map((t, i) => ({ ...t, id: `${c.id}-t${i}` })),
  };
}

export function mockSetCaseStatus(
  id: string,
  status: 'OPEN' | 'CLOSED',
): ApiCaseDetail | ApiError {
  if (status === 'CLOSED') closed.add(id);
  else closed.delete(id);
  return mockCaseDetail(id);
}

export function mockDeleteCase(id: string): void | ApiError {
  if (!MOCK_CASES.some((c) => c.id === id) || deleted.has(id))
    return apiError('NOT_FOUND', 404);
  deleted.add(id);
}

const GROUPS: Record<HistoryGroup, string[]> = {
  letter: ['LETTER_RECEIVED', 'CLAIM_CONFIRMED', 'CLAIM_REJECTED', 'REVISION'],
  // #124: события самого дела отдельно от писем; каждое событие ровно в одной группе
  case: ['CASE_CREATED_FROM_LETTER', 'DEADLINE_DONE'],
  question: ['QUESTION_ASKED'],
  draft: ['DRAFT_PREPARED', 'DRAFT_SENT', 'USER_REPORTED_SENT'],
};

export function mockHistory(type: HistoryGroup | undefined): HistoryPageResult {
  const items: ApiHistoryItem[] = MOCK_CASES.filter((c) => !deleted.has(c.id))
    .flatMap((c) =>
      c.timeline.map((t, i) => ({
        ...t,
        id: `${c.id}-t${i}`,
        caseId: c.id,
        caseTitle: c.title,
      })),
    )
    .filter((t) => !type || GROUPS[type].includes(t.type))
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  return { items, nextCursor: null };
}

/** Письмо из примерного дела в формате GET /letters/:id. */
export function mockCaseLetter(id: string): LetterDetail | null {
  for (const c of MOCK_CASES) {
    const l = c.letters.find((x) => x.id === id);
    if (!l || deleted.has(c.id)) continue;
    const confirmed = new Set(
      l.claims.filter((x) => x.status === 'CONFIRMED').map((x) => x.id),
    );
    return {
      letter: {
        id: l.id,
        caseId: c.id,
        sourceType: l.sourceType,
        text: l.rawText,
        pages: l.pages,
        files: [],
        createdAt: l.createdAt,
      },
      claims: l.claims.map(claimOf),
      deadlines: l.deadlines.map((d) => ({
        id: d.id,
        claimId: d.claimId,
        date: d.date,
        kind: d.kind,
        active: confirmed.has(d.claimId),
        done: d.doneAt !== null,
      })),
    };
  }
  return null;
}

export function mockExplanation(letterId: string): ApiExplanation | ApiError {
  const l = MOCK_CASES.flatMap((c) => c.letters).find((x) => x.id === letterId);
  if (!l) return apiError('NOT_FOUND', 404);
  if (!l.explanation) return apiError('DATES_NOT_VERIFIED', 422);
  const byId = new Map(l.claims.map((c) => [c.id, c]));
  const unconfirmed = (ids: string[]) =>
    ids.some((id) => byId.get(id)?.status !== 'CONFIRMED');
  const anyIds = l.claims.slice(0, 1).map((c) => c.id);
  const deadlines = l.deadlines.map((d) => ({
    date: d.date,
    claimId: d.claimId,
    kind: d.kind,
    confirmed: byId.get(d.claimId)?.status === 'CONFIRMED',
  }));
  return {
    lang: 'ru',
    about: {
      text: l.explanation.about,
      claimIds: anyIds,
      unconfirmed: unconfirmed(anyIds),
    },
    actions: l.explanation.actions.map((a) => ({
      ...a,
      unconfirmed: unconfirmed(a.claimIds),
    })),
    requests: l.claims
      .filter((c) => c.kind === 'REQUIREMENT')
      .map((c) => ({ claimId: c.id, ru: c.text, de: c.quote ?? c.value, unconfirmed: c.status !== 'CONFIRMED' })),
    deadlines,
    unconfirmed: l.explanation.unconfirmed,
    cached: true,
  };
}

// ---------- Черновик в режиме mock ----------

const mockDrafts = new Map<string, ApiDraft>();

export function mockDraftQuestions(
  letterId: string,
): DraftQuestions | ApiError {
  const c = MOCK_CASES.find((x) => x.letters.some((l) => l.id === letterId));
  if (!c) return apiError('NOT_FOUND', 404);
  return {
    letterId,
    caseId: c.id,
    questions: [
      {
        id: 'WHICH_DOCUMENTS',
        ru: 'Пожалуйста, сообщите, какие именно документы вам от меня нужны.',
      },
      {
        id: 'DEADLINE',
        ru: 'Пожалуйста, сообщите, до какого именно срока мне нужно ответить.',
      },
      {
        id: 'REASON',
        ru: 'Пожалуйста, сообщите, по какой причине вам нужны эти сведения.',
      },
    ],
    amounts: [],
    kinds: ['CLARIFICATION', 'DOCUMENTS', 'STATUS_REQUEST'],
    deadlines: [],
    extensionReasons: [
      { id: 'DOCUMENTS_PENDING', ru: 'Мне нужно больше времени, чтобы собрать документы' },
      { id: 'ADVICE', ru: 'Я хочу сначала получить консультацию' },
      { id: 'NONE', ru: 'Без указания причины' },
    ],
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function mockCreateDraft(
  caseId: string,
  args: DistributiveOmit<CreateDraftArgs, 'caseId'>,
): ApiDraft | ApiError {
  const { letterId } = args;
  const questionId: QuestionId | null = args.kind === 'CLARIFICATION' ? args.questionId : null;
  const c = MOCK_CASES.find((x) => x.id === caseId);
  const base = c?.drafts[0];
  if (!c || !base) return apiError('NO_CONFIRMED_CLAIMS', 409);
  const d: ApiDraft = {
    id: `${base.id}-${mockDrafts.size + 1}`,
    caseId,
    letterId,
    questionId,
    kind: args.kind,
    reason: args.kind === 'EXTENSION' ? args.reason : null,
    deadlineClaimId: null,
    outgoingTemplateId: null,
    edited: false,
    sentAt: null,
    sentVia: null,
    germanText: base.germanText,
    russianText: base.russianText,
    claimIds: base.claimIds,
    stale: false,
    status: 'PREPARED',
    verification: {
      ...base.verification,
      note: 'Проверка: текст соответствует шаблону и подтверждённым фактам. Это не юридическая проверка.',
    },
    createdAt: new Date().toISOString(),
  };
  mockDrafts.set(d.id, d);
  return d;
}

export function mockGetDraft(id: string): ApiDraft | ApiError {
  return mockDrafts.get(id) ?? apiError('NOT_FOUND', 404);
}
