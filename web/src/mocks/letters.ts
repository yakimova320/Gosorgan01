import { apiError, type ApiError } from '../api/errors';
import type { ApiTranslation, LetterClaim, LetterDetail, UploadResponse } from '../api/types';
import { mockUploadLetter } from './data';

/*
 * Письма в режиме mock (офлайн-показ без сервера): живут только в памяти страницы.
 * Правила те же, что на сервере: повтор решения без изменений, противоположное решение — CLAIM_STATE.
 */

const letters = new Map<string, LetterDetail>();

export function mockUpload(): UploadResponse {
  const l = mockUploadLetter();
  const claims: LetterClaim[] = l.claims.map((c) => ({
    ...c,
    status: 'UNCONFIRMED',
    supersedesId: null,
    relativeDeadline: false,
  }));
  const detail: LetterDetail = {
    letter: {
      id: l.id,
      caseId: null,
      sourceType: l.sourceType,
      text: l.rawText,
      pages: l.pages,
      files: [{ n: 1, mime: 'application/pdf', bytes: 2210 }],
      createdAt: l.createdAt,
      title: 'Jobcenter: документы к заявлению',
    },
    claims,
    deadlines: l.deadlines.map((d) => ({
      id: d.id,
      claimId: d.claimId,
      date: d.date,
      kind: d.kind,
      active: false,
      done: false,
    })),
  };
  letters.set(l.id, detail);
  return { ...detail, suggestions: [], extraction: { dropped: 0 } };
}

export const mockLetters = () => [...letters.values()];

export function mockLetter(id: string): LetterDetail | ApiError {
  return letters.get(id) ?? apiError('NOT_FOUND', 404);
}

export function mockConfirm(
  id: string,
  confirm: string[],
  reject: string[],
): LetterDetail | ApiError {
  const l = letters.get(id);
  if (!l) return apiError('NOT_FOUND', 404);
  for (const [list, _target, opposite] of [
    [confirm, 'CONFIRMED', 'REJECTED'],
    [reject, 'REJECTED', 'CONFIRMED'],
  ] as const) {
    for (const cid of list) {
      const c = l.claims.find((x) => x.id === cid);
      if (!c) return apiError('NOT_FOUND', 404);
      if (c.status === opposite) return apiError('CLAIM_STATE', 409);
    }
  }
  const next = l.claims.map((c) =>
    confirm.includes(c.id)
      ? { ...c, status: 'CONFIRMED' as const }
      : reject.includes(c.id)
        ? { ...c, status: 'REJECTED' as const }
        : c,
  );
  const updated = {
    ...l,
    claims: next,
    deadlines: l.deadlines.map((d) => ({
      ...d,
      active: next.find((c) => c.id === d.claimId)?.status === 'CONFIRMED',
    })),
  };
  letters.set(id, updated);
  return updated;
}

export function mockCorrect(
  id: string,
  claimId: string,
  value: string,
): LetterDetail | ApiError {
  const l = letters.get(id);
  const old = l?.claims.find((c) => c.id === claimId);
  if (!l || !old) return apiError('NOT_FOUND', 404);
  const fresh: LetterClaim = {
    ...old,
    id: `${claimId}-v${Date.now()}`,
    value,
    text: `${old.text.split(':')[0]}: ${value} (исправлено вами)`,
    quote: null,
    page: null,
    basis: 'USER',
    status: 'UNCONFIRMED',
    supersedesId: claimId,
  };
  const updated: LetterDetail = {
    ...l,
    claims: l.claims.map((c) => (c.id === claimId ? fresh : c)),
    deadlines: l.deadlines.map((d) =>
      d.claimId === claimId
        ? { ...d, claimId: fresh.id, date: value, active: false }
        : d,
    ),
  };
  letters.set(id, updated);
  return updated;
}

export function mockDelete(id: string): void {
  letters.delete(id);
}

export function mockAssign(
  id: string,
  caseId: string,
): { caseId: string; changed: boolean } | ApiError {
  const l = letters.get(id);
  if (!l) return apiError('NOT_FOUND', 404);
  letters.delete(id); // во входящих больше нет; дела в mock — примерные данные
  return { caseId, changed: true };
}

/** Поправка 8: новое название письма (только письма, загруженные в этой вкладке). */
export function mockRename(id: string, title: string): LetterDetail | ApiError {
  const l = letters.get(id);
  if (!l) return apiError('NOT_FOUND', 404);
  const next = { ...l, letter: { ...l.letter, title } };
  letters.set(id, next);
  return next;
}

/** Поправка 7: в примерных данных настоящего перевода нет, это сказано в первой строке. */
export function mockTranslate(text: string): ApiTranslation {
  return {
    lang: 'ru',
    machine: true,
    cached: false,
    text: `Примерные данные: настоящего перевода нет. Так будет выглядеть перевод письма.\n\n${text}`,
  };
}
