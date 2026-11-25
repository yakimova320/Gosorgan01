import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { berlinToday, toIsoDate } from '../common/berlin-date.js';
import { StorageService } from '../documents/storage.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { toClaimView } from '../letters/letters.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CaseDetail,
  CaseSummary,
  HistoryItem,
  HistoryQuery,
  ListCasesQuery,
  TimelineItem,
  TraceItem,
  UpdateCaseInput,
} from './cases.dto.js';
import { caseProgress, caseStage } from './stage.js';

export const HISTORY_PAGE = 30;

/** KORR 25.11: вопросы из чата в истории. Название группы вместо названия дела. */
export const CHAT_HISTORY_TITLE = 'Чат с Ja!sno';
const CHAT_QUESTION_CHARS = 120;

const HISTORY_TYPES: Record<NonNullable<HistoryQuery['type']>, string[]> = {
  letter: ['LETTER_RECEIVED', 'CLAIM_CONFIRMED', 'CLAIM_REJECTED', 'REVISION'],
  // #124: события самого дела отдельно от писем; каждое событие ровно в одной группе
  case: ['CASE_CREATED_FROM_LETTER', 'DEADLINE_DONE'],
  question: ['QUESTION_ASKED'],
  draft: ['DRAFT_PREPARED', 'DRAFT_SENT', 'USER_REPORTED_SENT'],
};

const caseInclude = {
  claims: {
    where: { status: { not: 'SUPERSEDED' as const } },
    select: { status: true },
  },
  deadlines: { include: { claim: { select: { status: true } } } },
  drafts: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 1,
    select: { status: true },
  },
  _count: { select: { letters: true } },
} satisfies Prisma.CaseInclude;

type CaseRow = Prisma.CaseGetPayload<{ include: typeof caseInclude }>;

/**
 * Поправка 24.11: дата самого письма (факт LETTER_DATE), а не дата загрузки.
 * Подтверждённый факт главнее неподтверждённого; отклонённый не показывается. Нет даты: null.
 */
export function letterDateOf(
  claims: { kind: string; value: string; status: string }[],
): { date: string; confirmed: boolean } | null {
  const dates = claims.filter(
    (c) => c.kind === 'LETTER_DATE' && /^\d{4}-\d{2}-\d{2}$/.test(c.value),
  );
  const found =
    dates.find((c) => c.status === 'CONFIRMED') ??
    dates.find((c) => c.status === 'UNCONFIRMED');
  return found
    ? { date: found.value, confirmed: found.status === 'CONFIRMED' }
    : null;
}

/** Дела (B07): список, карточка, история, журнал модели. Статус считается при чтении. */
@Injectable()
export class CasesService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async list(cabinetId: string, query: ListCasesQuery): Promise<CaseSummary[]> {
    const rows = await this.db.case.findMany({
      where: {
        cabinetId,
        ...(query.status === 'active'
          ? { status: 'OPEN' }
          : query.status === 'done'
            ? { status: 'CLOSED' }
            : {}),
      },
      include: caseInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    const q = query.q?.toLowerCase();
    const today = toIsoDate(berlinToday());
    return rows
      .filter(
        (c) =>
          !q ||
          [c.title, c.authority, c.caseNumber].some((v) =>
            v?.toLowerCase().includes(q),
          ),
      )
      .map((c) => toSummary(c, today));
  }

  async detail(cabinetId: string, caseId: string): Promise<CaseDetail> {
    const row = await this.db.case.findFirst({
      where: { id: caseId, cabinetId },
      include: caseInclude,
    });
    if (!row) throw new ApiError('NOT_FOUND');
    const [letters, claims, drafts, events] = await Promise.all([
      this.db.letter.findMany({
        where: { caseId, cabinetId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          claims: {
            where: { status: { not: 'SUPERSEDED' } },
            select: { kind: true, value: true, status: true },
          },
        },
      }),
      this.db.claim.findMany({
        where: { caseId, status: { not: 'SUPERSEDED' } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { deadline: true },
      }),
      this.db.draft.findMany({
        where: { caseId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.event.findMany({
        where: { caseId },
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return {
      ...toSummary(row, toIsoDate(berlinToday())),
      letters: letters.map((l) => ({
        id: l.id,
        createdAt: l.createdAt.toISOString(),
        sourceType: l.sourceType,
        title: l.title,
        authority: l.claims.find((c) => c.kind === 'AUTHORITY')?.value ?? null,
        letterDate: letterDateOf(l.claims),
        unconfirmed: l.claims.filter((c) => c.status === 'UNCONFIRMED').length,
      })),
      claims: claims.map(toClaimView),
      deadlines: claims
        .filter((c) => c.deadline)
        .map((c) => ({
          id: c.deadline!.id,
          claimId: c.id,
          date: toIsoDate(c.deadline!.date),
          kind: c.deadline!.kind,
          active: c.status === 'CONFIRMED',
          done: c.deadline!.doneAt !== null,
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      drafts: drafts.map((d) => ({
        id: d.id,
        kind: d.kind,
        status: d.status,
        stale: d.stale,
        createdAt: d.createdAt.toISOString(),
      })),
      timeline: events.map(toTimeline),
    };
  }

  async update(
    cabinetId: string,
    caseId: string,
    input: UpdateCaseInput,
  ): Promise<CaseDetail> {
    const res = await this.db.case.updateMany({
      where: { id: caseId, cabinetId },
      data: {
        ...(input.title ? { title: input.title } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
    });
    if (res.count !== 1) throw new ApiError('NOT_FOUND');
    return this.detail(cabinetId, caseId);
  }

  /**
   * Удаление дела: письма, факты, сроки, события, черновики (каскад), файлы писем
   * и LlmCall по делу и его письмам. Журнал других дел кабинета не трогается.
   */
  async remove(cabinetId: string, caseId: string): Promise<void> {
    const letters = await this.db.letter.findMany({
      where: { caseId, cabinetId },
      select: { id: true, files: true },
    });
    await this.db.$transaction(async (tx) => {
      const res = await tx.case.deleteMany({
        where: { id: caseId, cabinetId },
      });
      if (res.count !== 1) throw new ApiError('NOT_FOUND');
      await tx.llmCall.deleteMany({
        where: {
          OR: [{ caseId }, { letterId: { in: letters.map((l) => l.id) } }],
        },
      });
    });
    for (const l of letters)
      for (const f of (l.files as unknown as { fileKey: string }[]) ?? [])
        await this.storage.remove(f.fileKey);
  }

  /** Журнал модели по текущим письмам дела (после переноса письма — уже не здесь). */
  async trace(cabinetId: string, caseId: string): Promise<TraceItem[]> {
    const found = await this.db.case.findFirst({
      where: { id: caseId, cabinetId },
      select: { id: true },
    });
    if (!found) throw new ApiError('NOT_FOUND');
    const letterIds = (
      await this.db.letter.findMany({
        where: { caseId, cabinetId },
        select: { id: true },
      })
    ).map((l) => l.id);
    const calls = await this.db.llmCall.findMany({
      where: {
        cabinetId,
        OR: [{ letterId: { in: letterIds } }, { caseId, letterId: null }],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return calls.map((c) => ({
      id: c.id,
      letterId: c.letterId,
      promptName: c.promptName,
      promptVersion: c.promptVersion,
      model: c.model,
      ok: c.ok,
      error: c.error,
      attempts: c.attempts,
      durationMs: c.durationMs,
      tokensIn: c.tokensIn,
      tokensOut: c.tokensOut,
      createdAt: c.createdAt.toISOString(),
      input: c.input,
      output: c.output,
    }));
  }

  /**
   * История всех дел: по убыванию (at, id), страницами по 30.
   * Курсор: base64url строки «at|id» последнего элемента страницы.
   */
  async history(
    cabinetId: string,
    query: HistoryQuery,
  ): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    const after = cursor
      ? {
          OR: [
            { at: { lt: cursor.at } },
            { at: cursor.at, id: { lt: cursor.id } },
          ],
        }
      : {};
    const events = await this.db.event.findMany({
      where: {
        case: { cabinetId },
        ...(query.type
          ? { type: { in: HISTORY_TYPES[query.type] as never } }
          : {}),
        ...after,
      },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: HISTORY_PAGE + 1,
      include: { case: { select: { id: true, title: true } } },
    });
    // KORR 25.11: вопросы из чата — в «Всё» и в «Вопросы». Курсор общий: (время, id) по обоим спискам.
    const withChat = !query.type || query.type === 'question';
    const chat = withChat
      ? await this.db.chatMessage.findMany({
          where: {
            cabinetId,
            role: 'USER',
            ...(cursor
              ? {
                  OR: [
                    { createdAt: { lt: cursor.at } },
                    { createdAt: cursor.at, id: { lt: cursor.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: HISTORY_PAGE + 1,
          select: { id: true, text: true, createdAt: true },
        })
      : [];
    const merged: { at: Date; id: string; item: HistoryItem }[] = [
      ...events.map((e) => ({
        at: e.at,
        id: e.id,
        item: { ...toTimeline(e), caseId: e.case.id, caseTitle: e.case.title },
      })),
      ...chat.map((m) => ({
        at: m.createdAt,
        id: m.id,
        item: {
          id: m.id,
          type: 'CHAT_QUESTION',
          at: m.createdAt.toISOString(),
          title:
            m.text.length > CHAT_QUESTION_CHARS
              ? `${m.text.slice(0, CHAT_QUESTION_CHARS)}…`
              : m.text,
          subtitle: 'Вопрос в чате',
          caseId: null,
          caseTitle: CHAT_HISTORY_TITLE,
        } satisfies HistoryItem,
      })),
    ].sort((a, b) =>
      b.at.getTime() !== a.at.getTime()
        ? b.at.getTime() - a.at.getTime()
        : b.id < a.id
          ? -1
          : b.id > a.id
            ? 1
            : 0,
    );
    const page = merged.slice(0, HISTORY_PAGE);
    const last = page[page.length - 1];
    return {
      items: page.map((m) => m.item),
      nextCursor:
        merged.length > HISTORY_PAGE && last
          ? encodeCursor(last.at, last.id)
          : null,
    };
  }
}

function toSummary(c: CaseRow, today: string): CaseSummary {
  const { stage, nextDeadline } = caseStage(
    {
      status: c.status,
      deadlines: c.deadlines.map((d) => ({
        date: toIsoDate(d.date),
        kind: d.kind,
        confirmed: d.claim.status === 'CONFIRMED',
        done: d.doneAt !== null,
      })),
      hasUnconfirmedClaims: c.claims.some((cl) => cl.status === 'UNCONFIRMED'),
      lastDraftSent: c.drafts[0]?.status === 'SENT',
    },
    today,
  );
  return {
    id: c.id,
    title: c.title,
    authority: c.authority,
    caseNumber: c.caseNumber,
    origin: c.origin,
    status: c.status,
    stage,
    nextDeadline,
    counts: {
      letters: c._count.letters,
      unconfirmed: c.claims.filter((cl) => cl.status === 'UNCONFIRMED').length,
    },
    progress: caseProgress({
      closed: c.status === 'CLOSED',
      hasClaims: c.claims.length > 0,
      unconfirmed: c.claims.filter((cl) => cl.status === 'UNCONFIRMED').length,
      openDeadlines: c.deadlines.filter(
        (d) => d.claim.status === 'CONFIRMED' && d.doneAt === null,
      ).length,
      replySent: c.drafts[0]?.status === 'SENT',
    }),
    updatedAt: c.updatedAt.toISOString(),
  };
}

const SENT_VIA_RU: Record<string, string> = {
  post: 'Почтой',
  online: 'Онлайн',
  email: 'По e-mail',
  in_person: 'Лично',
  other: 'Другим способом',
};

const TIMELINE_TITLE: Record<string, string> = {
  LETTER_RECEIVED: 'Письмо добавлено в дело',
  CASE_CREATED_FROM_LETTER: 'Дело создано из письма',
  CLAIM_CONFIRMED: 'Факты подтверждены',
  CLAIM_REJECTED: 'Факты отклонены',
  QUESTION_ASKED: 'Вопрос по делу',
  USER_REPORTED_SENT: 'Вы отметили: ответ отправлен',
  DRAFT_PREPARED: 'Черновик ответа',
  DRAFT_SENT: 'Черновик отправлен',
  DEADLINE_DONE: 'Срок выполнен',
  REVISION: 'Изменение',
};

function toTimeline(e: {
  id: string;
  type: string;
  at: Date;
  details: unknown;
}): TimelineItem {
  const d = (e.details ?? {}) as {
    letterId?: string;
    draftId?: string;
    claimIds?: string[];
    text?: string;
    via?: string;
    date?: string;
  };
  return {
    id: e.id,
    type: e.type,
    at: e.at.toISOString(),
    title:
      e.type === 'REVISION' && d.text
        ? d.text
        : (TIMELINE_TITLE[e.type] ?? e.type),
    ...(d.claimIds ? { subtitle: `Фактов: ${d.claimIds.length}` } : {}),
    // B12: «Я отправил(а)» — канал и дата со слов пользователя
    ...(e.type === 'USER_REPORTED_SENT' && d.via
      ? {
          subtitle: `${SENT_VIA_RU[d.via] ?? d.via}${d.date ? ` · ${d.date.split('-').reverse().join('.')}` : ''}`,
        }
      : {}),
    ...(d.letterId ? { letterId: d.letterId } : {}),
    ...(d.draftId ? { draftId: d.draftId } : {}),
  };
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url')
    .toString('utf8')
    .split('|');
  const at = new Date(iso ?? '');
  if (!id || Number.isNaN(at.getTime()))
    throw new ApiError('VALIDATION_FAILED', {
      fields: { cursor: 'Неверный курсор' },
    });
  return { at, id };
}
