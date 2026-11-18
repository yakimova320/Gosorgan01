import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApiError } from '../common/api-error.js';
import { DocumentsService } from '../documents/documents.service.js';
import { lockActiveCabinet } from '../erasure/cabinet-lock.js';
import { StorageService } from '../documents/storage.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LlmService, MAX_ATTEMPTS } from '../llm/llm.service.js';
import { ExtractV2Schema } from '../llm/schemas/extract.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildClaims, checkUserValue, claimText } from './claims.builder.js';
import type {
  ClaimView,
  AssignLetterInput,
  ConfirmClaimsInput,
  CorrectClaimInput,
  DeadlineView,
  InboxItem,
  LetterDetail,
  LetterView,
  UploadLetterResponse,
} from './letters.dto.js';

interface StoredFile {
  n: number;
  fileKey: string;
  mime: string;
  bytes: number;
}

type Tx = Prisma.TransactionClient;

const RELATIVE_PREFIX = 'Срок без точной даты';

/** Календарный день YYYY-MM-DD ↔ DateTime полночь UTC, без локального часового пояса. */
const dayToDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const dateToDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Письма и факты (B05, B06).
 * Загрузка: проверки → текст → extract.v2 → проверка цитат и значений → одна транзакция
 * (Letter, Claim, Deadline). На всю загрузку не больше 3 обращений к модели.
 * Любое изменение фактов сбрасывает объяснение письма и помечает затронутые черновики stale.
 */
@Injectable()
export class LettersService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(LlmService) private readonly llm: LlmService,
  ) {}

  // ---------- Загрузка ----------

  async upload(cabinetId: string, data: Buffer): Promise<UploadLetterResponse> {
    const kind = this.documents.precheck(data);
    const letterId = randomUUID();
    const context = { cabinetId, letterId };
    const doc = await this.documents.extractText(data, kind, context);

    // Общий бюджет: фото уже потратило 1–2 обращения на transcribe.
    const { data: extracted } = await this.llm.callWithTrace({
      prompt: 'extract',
      version: 2,
      variables: { letterText: doc.text },
      schema: ExtractV2Schema,
      maxAttempts: MAX_ATTEMPTS - doc.llmAttempts,
      context,
    });
    const { claims, dropped } = buildClaims(
      extracted,
      doc.pageTexts,
      doc.sourceType === 'IMAGE',
    );

    const ext = kind === 'jpeg' ? 'jpg' : kind;
    const fileKey = this.storage.newKey(cabinetId, ext);
    const files: StoredFile[] = [
      { n: 1, fileKey, mime: doc.mime, bytes: data.length },
    ];

    // Файл пишется под блокировкой строки кабинета (A01): удаление аккаунта ждёт эту транзакцию,
    // а после его начала загрузка получает 409 ACCOUNT_DELETING и файла не пишет.
    try {
      await this.db.$transaction(async (tx) => {
        if (!(await lockActiveCabinet(tx, cabinetId)))
          throw new ApiError('ACCOUNT_DELETING');
        await this.storage.write(fileKey, data);
        try {
          await tx.letter.create({
            data: {
              id: letterId,
              cabinetId,
              sourceType: doc.sourceType,
              rawText: doc.text,
              pages: doc.pages,
              files: files as unknown as object[],
            },
          });
          for (const c of claims) {
            const row = await tx.claim.create({
              data: {
                letterId,
                kind: c.kind,
                value: c.value,
                text: c.text,
                quote: c.quote,
                page: c.page,
                basis: 'DOCUMENT',
                status: 'UNCONFIRMED',
                updatedBy: 'SYSTEM',
              },
            });
            if (c.kind === 'DEADLINE' && c.deadlineKind) {
              await tx.deadline.create({
                data: {
                  letterId,
                  claimId: row.id,
                  date: dayToDate(c.value),
                  kind: c.deadlineKind,
                },
              });
            }
          }
        } catch (e) {
          // до отката транзакции, пока строка кабинета ещё заблокирована
          await this.storage.remove(fileKey);
          throw e;
        }
      });
    } catch (e) {
      await this.storage.remove(fileKey); // сбой фиксации транзакции
      throw e;
    }

    const detail = await this.detail(cabinetId, letterId);
    return {
      ...detail,
      suggestions: await this.suggestions(cabinetId, detail.claims),
      extraction: { dropped: dropped.length },
    };
  }

  /** Подсказка дела: совпадает номер дела. Решает человек (ТЗ v3 6.4). */
  private async suggestions(cabinetId: string, claims: ClaimView[]) {
    const number = claims.find((c) => c.kind === 'CASE_NUMBER')?.value;
    if (!number) return [];
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const cases = await this.db.case.findMany({
      where: { cabinetId, caseNumber: { not: null } },
      select: { id: true, title: true, caseNumber: true },
    });
    return cases
      .filter((c) => norm(c.caseNumber ?? '') === norm(number))
      .slice(0, 3)
      .map((c) => ({
        caseId: c.id,
        title: c.title,
        reason: `Совпадает номер дела ${number}`,
      }));
  }

  // ---------- Чтение ----------

  async list(cabinetId: string, inboxOnly: boolean): Promise<InboxItem[]> {
    const letters = await this.db.letter.findMany({
      where: { cabinetId, ...(inboxOnly ? { caseId: null } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        claims: {
          where: { status: { not: 'SUPERSEDED' } },
          select: { kind: true, value: true, status: true },
        },
      },
    });
    return letters.map((l) => ({
      id: l.id,
      createdAt: l.createdAt.toISOString(),
      sourceType: l.sourceType,
      authority: l.claims.find((c) => c.kind === 'AUTHORITY')?.value ?? null,
      caseNumber: l.claims.find((c) => c.kind === 'CASE_NUMBER')?.value ?? null,
      unconfirmed: l.claims.filter((c) => c.status === 'UNCONFIRMED').length,
    }));
  }

  async detail(cabinetId: string, letterId: string): Promise<LetterDetail> {
    const letter = await this.db.letter.findFirst({
      where: { id: letterId, cabinetId },
      include: {
        claims: {
          where: { status: { not: 'SUPERSEDED' } },
          orderBy: { createdAt: 'asc' },
          include: { deadline: true },
        },
      },
    });
    if (!letter) throw new ApiError('NOT_FOUND');
    const claims = letter.claims.map(toClaimView);
    const deadlines: DeadlineView[] = letter.claims
      .filter((c) => c.deadline)
      .map((c) => ({
        id: c.deadline!.id,
        claimId: c.id,
        date: dateToDay(c.deadline!.date),
        kind: c.deadline!.kind,
        active: c.status === 'CONFIRMED',
        done: c.deadline!.doneAt !== null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      letter: toLetterView(letter),
      claims,
      deadlines,
    };
  }

  // ---------- Подтверждение ----------

  /**
   * Одна транзакция. Повтор того же решения ничего не меняет.
   * Противоположное решение, заменённый факт, чужой факт: ошибка, ничего не записано.
   * Состояние проверяется условным обновлением: параллельный запрос не проскочит.
   */
  async confirm(
    cabinetId: string,
    letterId: string,
    input: ConfirmClaimsInput,
  ): Promise<LetterDetail> {
    await this.db.$transaction(async (tx) => {
      const letter = await this.ownLetter(tx, cabinetId, letterId);
      const wanted = [...input.confirm, ...input.reject];
      const rows = await tx.claim.findMany({
        where: { id: { in: wanted }, letterId },
        select: { id: true, status: true },
      });
      if (rows.length !== new Set(wanted).size) throw new ApiError('NOT_FOUND');
      const status = new Map(rows.map((r) => [r.id, r.status]));
      const changed: string[] = [];
      for (const [list, target, opposite] of [
        [input.confirm, 'CONFIRMED', 'REJECTED'],
        [input.reject, 'REJECTED', 'CONFIRMED'],
      ] as const) {
        const toChange: string[] = [];
        for (const id of new Set(list)) {
          const s = status.get(id);
          if (s === target) continue; // повтор: без изменений
          if (s === opposite || s === 'SUPERSEDED')
            throw new ApiError('CLAIM_STATE', { claimId: id, status: s });
          toChange.push(id);
        }
        if (toChange.length === 0) continue;
        const res = await tx.claim.updateMany({
          where: { id: { in: toChange }, letterId, status: 'UNCONFIRMED' },
          data: { status: target, updatedBy: 'USER' },
        });
        if (res.count !== toChange.length)
          throw new ApiError('CLAIM_STATE', { reason: 'changed-concurrently' });
        changed.push(...toChange);
        // История дела: только реально изменённые факты, повтор события не создаёт.
        if (letter.caseId)
          await addEvent(
            tx,
            letter.caseId,
            target === 'CONFIRMED' ? 'CLAIM_CONFIRMED' : 'CLAIM_REJECTED',
            {
              letterId,
              claimIds: toChange,
            },
          );
      }
      if (changed.length) await this.invalidate(tx, letter, changed);
    });
    return this.detail(cabinetId, letterId);
  }

  // ---------- Исправление ----------

  /**
   * Новая запись USER/UNCONFIRMED без цитаты, старая SUPERSEDED (ТЗ v4 16.4).
   * Срок старого факта заменяется сроком нового (кандидат до подтверждения).
   * Два одновременных исправления: второе получает CLAIM_STATE.
   */
  async correct(
    cabinetId: string,
    letterId: string,
    claimId: string,
    input: CorrectClaimInput,
  ): Promise<LetterDetail> {
    await this.db.$transaction(async (tx) => {
      const letter = await this.ownLetter(tx, cabinetId, letterId);
      const old = await tx.claim.findFirst({
        where: { id: claimId, letterId },
        include: { deadline: true },
      });
      if (!old) throw new ApiError('NOT_FOUND');
      if (old.status === 'SUPERSEDED')
        throw new ApiError('CLAIM_STATE', { claimId, status: old.status });
      const relative =
        old.kind === 'OTHER' && old.text.startsWith(RELATIVE_PREFIX);
      const problem = checkUserValue(old.kind, input.value);
      if (problem)
        throw new ApiError('VALIDATION_FAILED', { fields: { value: problem } });

      const res = await tx.claim.updateMany({
        where: { id: claimId, letterId, status: { not: 'SUPERSEDED' } },
        data: {
          status: 'SUPERSEDED',
          reason: 'Исправлено пользователем',
          updatedBy: 'USER',
        },
      });
      if (res.count !== 1)
        throw new ApiError('CLAIM_STATE', { reason: 'changed-concurrently' });

      const deadlineKind = old.deadline?.kind;
      const created = await tx.claim.create({
        data: {
          letterId,
          caseId: old.caseId,
          kind: old.kind,
          value: input.value,
          text:
            input.text ??
            `${claimText(relative ? 'RELATIVE_DEADLINE' : (old.kind as never), input.value, deadlineKind as never)} (исправлено вами)`,
          quote: null, // цитата оригинала не доказывает новое значение
          page: null,
          basis: 'USER',
          status: 'UNCONFIRMED',
          supersedesId: old.id,
          updatedBy: 'USER',
        },
      });
      if (old.deadline) {
        await tx.deadline.delete({ where: { id: old.deadline.id } });
        await tx.deadline.create({
          data: {
            letterId,
            caseId: old.deadline.caseId,
            claimId: created.id,
            date: dayToDate(input.value),
            kind: old.deadline.kind,
          },
        });
      }
      await this.invalidate(tx, letter, [old.id]);
      if (letter.caseId)
        await addEvent(tx, letter.caseId, 'REVISION', {
          letterId,
          claimId: created.id,
          text: 'Факт исправлен',
        });
    });
    return this.detail(cabinetId, letterId);
  }

  // ---------- Удаление и возврат во входящие ----------

  /**
   * mode=inbox: письмо остаётся во входящих (из дела отвязывается вместе с фактами и сроками).
   * Без mode: полное удаление письма, фактов, сроков, файла и LlmCall по письму.
   * В обоих случаях объяснение и черновики бывшего дела инвалидируются.
   */
  async remove(
    cabinetId: string,
    letterId: string,
    mode: 'inbox' | undefined,
  ): Promise<void> {
    if (mode === 'inbox') {
      await this.db.$transaction(async (tx) => {
        const letter = await this.ownLetter(tx, cabinetId, letterId);
        if (letter.caseId === null) return;
        await this.invalidate(tx, letter, 'all');
        await addEvent(tx, letter.caseId, 'REVISION', {
          letterId,
          text: 'Письмо убрано из дела во входящие',
        });
        await touchCase(tx, letter.caseId);
        await tx.claim.updateMany({
          where: { letterId },
          data: { caseId: null },
        });
        await tx.deadline.updateMany({
          where: { letterId },
          data: { caseId: null },
        });
        await tx.letter.update({
          where: { id: letterId },
          data: { caseId: null },
        });
      });
      return;
    }
    const found = await this.removeLetter(cabinetId, letterId);
    if (!found) throw new ApiError('NOT_FOUND');
  }

  /**
   * Полное удаление письма: строка (факты и сроки каскадом), файлы и журнал LlmCall по letterId.
   * Удаление аккаунта (A01) удаляет LlmCall по cabinetId.
   */
  async removeLetter(cabinetId: string, letterId: string): Promise<boolean> {
    const letter = await this.db.letter.findFirst({
      where: { id: letterId, cabinetId },
    });
    if (!letter) return false;
    await this.db.$transaction(async (tx) => {
      await this.invalidate(tx, letter, 'all');
      if (letter.caseId) {
        await addEvent(tx, letter.caseId, 'REVISION', {
          letterId,
          text: 'Письмо удалено',
        });
        await touchCase(tx, letter.caseId);
      }
      await tx.llmCall.deleteMany({ where: { letterId } });
      await tx.letter.delete({ where: { id: letterId } });
    });
    for (const f of (letter.files as unknown as StoredFile[]) ?? [])
      await this.storage.remove(f.fileKey);
    return true;
  }

  // ---------- В дело (B07) ----------

  /**
   * Письмо в дело: одна транзакция. Строка письма блокируется первым UPDATE,
   * поэтому параллельные назначения идут по очереди и не создают два новых дела.
   * Повтор в то же дело: без изменений и без событий.
   * Перенос из другого дела: объяснение письма сбрасывается, черновики старого дела с его фактами — stale.
   * Новое дело: ведомство и номер только из подтверждённых фактов, иначе null и «Новое дело».
   */
  async assign(
    cabinetId: string,
    letterId: string,
    input: AssignLetterInput,
  ): Promise<{ caseId: string; changed: boolean }> {
    return this.db.$transaction(async (tx) => {
      const locked = await tx.letter.updateMany({
        where: { id: letterId, cabinetId },
        data: { cabinetId },
      });
      if (locked.count !== 1) throw new ApiError('NOT_FOUND');
      const letter = await tx.letter.findUniqueOrThrow({
        where: { id: letterId },
        select: { id: true, caseId: true },
      });

      let targetId: string;
      if ('caseId' in input) {
        const target = await tx.case.findFirst({
          where: { id: input.caseId, cabinetId },
          select: { id: true, status: true },
        });
        if (!target) throw new ApiError('NOT_FOUND');
        if (letter.caseId === target.id)
          return { caseId: target.id, changed: false };
        if (target.status === 'CLOSED') throw new ApiError('CASE_CLOSED');
        targetId = target.id;
      } else {
        if (letter.caseId)
          throw new ApiError('LETTER_IN_CASE', { caseId: letter.caseId });
        const confirmed = await tx.claim.findMany({
          where: { letterId, status: 'CONFIRMED' },
          orderBy: { createdAt: 'asc' },
          select: { kind: true, value: true },
        });
        const first = (k: string) =>
          confirmed.find((c) => c.kind === k)?.value ?? null;
        const authority = first('AUTHORITY');
        const requirement = first('REQUIREMENT');
        const title =
          input.newCase.title ??
          (authority && requirement
            ? `${authority}: ${requirement}`
            : (authority ?? 'Новое дело')
          ).slice(0, 120);
        const created = await tx.case.create({
          data: {
            cabinetId,
            title,
            authority,
            caseNumber: first('CASE_NUMBER'),
          },
        });
        targetId = created.id;
        await addEvent(tx, targetId, 'CASE_CREATED_FROM_LETTER', { letterId });
      }

      if (letter.caseId) {
        await this.invalidate(tx, letter, 'all');
        await addEvent(tx, letter.caseId, 'REVISION', {
          letterId,
          text: 'Письмо перенесено в другое дело',
        });
        await touchCase(tx, letter.caseId);
      }
      await tx.letter.update({
        where: { id: letterId },
        data: { caseId: targetId },
      });
      await tx.claim.updateMany({
        where: { letterId },
        data: { caseId: targetId },
      });
      await tx.deadline.updateMany({
        where: { letterId },
        data: { caseId: targetId },
      });
      await addEvent(tx, targetId, 'LETTER_RECEIVED', { letterId });
      await touchCase(tx, targetId);
      return { caseId: targetId, changed: true };
    });
  }

  // ---------- Общее ----------

  private async ownLetter(tx: Tx, cabinetId: string, letterId: string) {
    const letter = await tx.letter.findFirst({
      where: { id: letterId, cabinetId },
      select: { id: true, caseId: true },
    });
    if (!letter) throw new ApiError('NOT_FOUND');
    return letter;
  }

  /**
   * Производные данные после изменения фактов: объяснение письма сбрасывается,
   * черновики дела, которые используют затронутые факты, помечаются stale.
   * Действующие сроки не хранятся отдельно: они считаются из подтверждённых фактов при чтении.
   */
  private async invalidate(
    tx: Tx,
    letter: { id: string; caseId: string | null },
    claimIds: string[] | 'all',
  ): Promise<void> {
    await tx.letter.update({
      where: { id: letter.id },
      data: { explanation: Prisma.DbNull },
    });
    if (!letter.caseId) return;
    const ids =
      claimIds === 'all'
        ? (
            await tx.claim.findMany({
              where: { letterId: letter.id },
              select: { id: true },
            })
          ).map((c) => c.id)
        : claimIds;
    const drafts = await tx.draft.findMany({
      where: { caseId: letter.caseId, stale: false },
      select: { id: true, claimIds: true },
    });
    const affected = drafts
      .filter((d) =>
        ((d.claimIds as unknown as string[]) ?? []).some((id) =>
          ids.includes(id),
        ),
      )
      .map((d) => d.id);
    if (affected.length)
      await tx.draft.updateMany({
        where: { id: { in: affected } },
        data: { stale: true },
      });
  }
}

export function toClaimView(c: {
  id: string;
  kind: string;
  value: string;
  text: string;
  quote: string | null;
  page: number | null;
  basis: string;
  status: string;
  supersedesId: string | null;
}): ClaimView {
  return {
    id: c.id,
    kind: c.kind,
    value: c.value,
    text: c.text,
    quote: c.quote,
    page: c.page,
    basis: c.basis as ClaimView['basis'],
    status: c.status as ClaimView['status'],
    supersedesId: c.supersedesId,
    relativeDeadline: c.kind === 'OTHER' && c.text.startsWith(RELATIVE_PREFIX),
  };
}

function toLetterView(row: {
  id: string;
  caseId: string | null;
  sourceType: string;
  rawText: string;
  pages: unknown;
  files: unknown;
  createdAt: Date;
}): LetterView {
  const pages =
    (row.pages as { n: number; readable: boolean; chars: number }[]) ?? [];
  const files = (row.files as StoredFile[]) ?? [];
  return {
    id: row.id,
    caseId: row.caseId,
    sourceType: row.sourceType as LetterView['sourceType'],
    text: row.rawText,
    pages: pages.map(({ n, readable, chars }) => ({ n, readable, chars })),
    files: files.map(({ n, mime, bytes }) => ({ n, mime, bytes })),
    createdAt: row.createdAt.toISOString(),
  };
}

type EventType =
  | 'LETTER_RECEIVED'
  | 'CASE_CREATED_FROM_LETTER'
  | 'CLAIM_CONFIRMED'
  | 'CLAIM_REJECTED'
  | 'REVISION';

/** Событие истории дела. */
export async function addEvent(
  tx: Tx,
  caseId: string,
  type: EventType,
  details: Record<string, unknown>,
): Promise<void> {
  await tx.event.create({ data: { caseId, type, details: details as object } });
}

/** Дело изменилось: обновить updatedAt (статус считается при чтении). */
async function touchCase(tx: Tx, caseId: string): Promise<void> {
  await tx.case.update({
    where: { id: caseId },
    data: { updatedAt: new Date() },
  });
}
