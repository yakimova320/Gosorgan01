import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isEnvelope } from '@jasno/shared';
import { ApiError } from '../common/api-error.js';
import { DocumentsService } from '../documents/documents.service.js';
import { MIME } from '../documents/file-checks.js';
import { lockActiveCabinet } from '../erasure/cabinet-lock.js';
import { StorageService } from '../documents/storage.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { LlmService } from '../llm/llm.service.js';
import { ExtractV5Schema } from '../llm/schemas/extract.schema.js';
import { ArchiveRepository } from '../archive/archive.repository.js';
import { checkSummary, summaryForEmbedding } from '../archive/summary-check.js';
import { sealClaim } from '../crypto/claim-fields.js';
import { VaultService } from '../crypto/vault.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertAiConsent } from '../cabinet/ai-consent.js';
import { cabinetLanguage, languageVariables } from '../common/language.js';
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
  RenameLetterInput,
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
    @Inject(VaultService) private readonly vault: VaultService,
    @Inject(ArchiveRepository) private readonly archive: ArchiveRepository,
  ) {}

  // ---------- Загрузка ----------

  /** B11: files — один PDF или до 10 фото по порядку страниц. */
  async upload(
    cabinetId: string,
    uploaded: Buffer[],
  ): Promise<UploadLetterResponse> {
    // K11: без согласия на анализ ИИ письмо не принимается и не сохраняется
    await assertAiConsent(this.db, cabinetId);
    // E01: ключ письма из браузера (x-jasno-new-key). Нет ключа архива или ключа в запросе —
    // ошибка до обращения к модели. null: кабинет без шифрования (только NODE_ENV=test).
    const key = await this.vault.takeNewKey(cabinetId);
    const keyId = key?.keyId ?? null;
    const inputs = this.documents.precheckAll(uploaded);
    const letterId = randomUUID();
    const context = { cabinetId, letterId };
    // B18: одна операция на загрузку. Резерв лимита — перед первым обращением к модели,
    // то есть после проверки файлов; фото и скан = transcribe + extract в общем пределе 3 обращений.
    const operation = this.llm.operation(cabinetId, 'UPLOAD');
    const doc = await this.documents.extractText(inputs, context, operation);

    const { data: extracted } = await this.llm.callWithTrace({
      prompt: 'extract',
      version: 5, // E01: extract.v5 — и обезличенное резюме для поиска по архиву
      variables: { letterText: doc.text, ...languageVariables(await cabinetLanguage(this.db, cabinetId)) },
      schema: ExtractV5Schema,
      context,
      operation,
    });
    // Текст распознан моделью (фото, скан): цитаты сравниваются нестрого.
    const { claims, dropped } = buildClaims(
      extracted,
      doc.pageTexts,
      doc.sourceType !== 'PDF_TEXT',
    );

    // E01: резюме для поиска — только обезличенное; вектор считается здесь, в памяти.
    // Не получилось (проверка, сбой векторов): письмо сохраняется без резюме и не попадает в поиск.
    const profile = (
      await this.db.cabinet.findUnique({ where: { id: cabinetId }, select: { profile: true } })
    )?.profile as { firstName?: string; lastName?: string; address?: string } | null;
    const summary = checkSummary(extracted.summary, profile ?? null);
    let summaryVector: number[] | null = null;
    if (summary && operation.remaining > 0) {
      try {
        const [v] = await this.llm.embed({
          texts: [summaryForEmbedding(summary)],
          context,
          operation,
          maxAttempts: 1,
        });
        summaryVector = v ?? null;
      } catch {
        summaryVector = null;
      }
    }

    // Оригиналы по порядку страниц: n = номер файла (фото n = страница n; PDF — один файл).
    // E01: в хранилище — шифротекст JXB1 ключом письма; путь случайный, без имени файла.
    const files: (StoredFile & { data: Buffer })[] = [];
    for (const [i, f] of inputs.entries())
      files.push({
        n: i + 1,
        fileKey: this.storage.newKey(cabinetId, f.kind === 'jpeg' ? 'jpg' : f.kind),
        mime: MIME[f.kind],
        bytes: f.data.length,
        data: await this.vault.sealBytes(cabinetId, keyId, f.data),
      });
    const sealed = {
      rawText: await this.vault.seal(cabinetId, keyId, doc.text),
      // поправка 8: название — подсказка модели, только если её цитата есть в письме
      title: await this.vault.sealOrNull(cabinetId, keyId, verifiedTitle(extracted.title, doc.text)),
      claims: await Promise.all(claims.map((c) => sealClaim(this.vault, cabinetId, keyId, c))),
      summary:
        summary && summaryVector
          ? keyId
            ? ((await this.vault.sealJson(cabinetId, keyId, summary)) as string)
            : JSON.stringify(summary)
          : null,
    };
    const removeAll = () =>
      Promise.all(files.map((f) => this.storage.remove(f.fileKey)));

    // Файл пишется под блокировкой строки кабинета (A01): удаление аккаунта ждёт эту транзакцию,
    // а после его начала загрузка получает 409 ACCOUNT_DELETING и файла не пишет.
    try {
      await this.db.$transaction(async (tx) => {
        if (!(await lockActiveCabinet(tx, cabinetId)))
          throw new ApiError('ACCOUNT_DELETING');
        for (const f of files) await this.storage.write(f.fileKey, f.data);
        try {
          await this.vault.saveKey(tx, cabinetId, key);
          await tx.letter.create({
            data: {
              id: letterId,
              cabinetId,
              keyId,
              sourceType: doc.sourceType,
              rawText: sealed.rawText,
              title: sealed.title,
              pages: doc.pages,
              files: files.map(({ n, fileKey, mime, bytes }) => ({
                n,
                fileKey,
                mime,
                bytes,
              })),
            },
          });
          for (const [i, c] of claims.entries()) {
            const enc = sealed.claims[i]!;
            const row = await tx.claim.create({
              data: {
                letterId,
                kind: c.kind,
                value: enc.value,
                text: enc.text,
                quote: enc.quote,
                page: c.page,
                relative: c.kind === 'OTHER' && c.text.startsWith(RELATIVE_PREFIX),
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
          if (sealed.summary && summaryVector)
            await this.archive.saveSummary(tx, {
              cabinetId,
              letterId,
              summary: sealed.summary,
              embedderId: this.llm.embedderId,
              vector: summaryVector,
            });
        } catch (e) {
          // до отката транзакции, пока строка кабинета ещё заблокирована
          await removeAll();
          throw e;
        }
      }, { timeout: this.storage.uploadTxTimeoutMs }); // ST01: запись в бакет дольше, чем на диск
    } catch (e) {
      await removeAll(); // сбой фиксации транзакции
      throw e;
    }

    const detail = await this.detail(cabinetId, letterId);
    return {
      ...detail,
      // E01: номер дела сравнивается по открытому значению из этого запроса; номера зашифрованных
      // дел сравнивает браузер (сервер их не видит)
      suggestions: await this.suggestions(
        cabinetId,
        claims.map((c) => ({ kind: c.kind, value: c.value })),
      ),
      extraction: { dropped: dropped.length },
    };
  }

  /** Подсказка дела: совпадает номер дела. Решает человек (ТЗ v3 6.4). */
  private async suggestions(cabinetId: string, claims: { kind: string; value: string }[]) {
    const number = claims.find((c) => c.kind === 'CASE_NUMBER')?.value;
    if (!number) return [];
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const cases = await this.db.case.findMany({
      where: { cabinetId, caseNumber: { not: null } },
      select: { id: true, title: true, caseNumber: true },
    });
    return cases
      .filter((c) => !isEnvelope(c.caseNumber) && norm(c.caseNumber ?? '') === norm(number))
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
      title: l.title,
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

  /** B11: оригинал письма только владельцу. Чужое письмо, нет такого номера или файла: 404. */
  async originalFile(
    cabinetId: string,
    letterId: string,
    n: number,
  ): Promise<{ data: Buffer; mime: string }> {
    const letter = await this.db.letter.findFirst({
      where: { id: letterId, cabinetId },
      select: { files: true },
    });
    const file = ((letter?.files as StoredFile[] | undefined) ?? []).find(
      (f) => f.n === n,
    );
    if (!file) throw new ApiError('NOT_FOUND');
    const data = await this.storage.read(file.fileKey);
    if (!data) throw new ApiError('NOT_FOUND');
    return { data, mime: file.mime };
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
      const relative = old.relative;
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
      const enc = await sealClaim(this.vault, cabinetId, letter.keyId, {
        kind: old.kind,
        value: input.value,
        text:
          input.text ??
          `${claimText(relative ? 'RELATIVE_DEADLINE' : (old.kind as never), input.value, deadlineKind as never)} (исправлено вами)`,
      });
      const created = await tx.claim.create({
        data: {
          letterId,
          caseId: old.caseId,
          kind: old.kind,
          value: enc.value,
          text: enc.text,
          relative,
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
      // E01: ключ письма больше не нужен (резюме удалено каскадом)
      if (letter.keyId) await tx.documentKey.deleteMany({ where: { id: letter.keyId, cabinetId } });
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
        // E01: значения фактов зашифрованы ключом письма — нужен ключ из запроса (иначе 428)
        const confirmed = await this.vault.open(
          cabinetId,
          await tx.claim.findMany({
            where: { letterId, status: 'CONFIRMED' },
            orderBy: { createdAt: 'asc' },
            select: { kind: true, value: true },
          }),
        );
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
        // E01: у дела свой ключ (новый ключ из запроса); название, ведомство и номер — шифротекст
        const caseKey = await this.vault.takeNewKey(cabinetId, tx);
        const caseKeyId = caseKey?.keyId ?? null;
        await this.vault.saveKey(tx, cabinetId, caseKey);
        const created = await tx.case.create({
          data: {
            cabinetId,
            keyId: caseKeyId,
            title: await this.vault.seal(cabinetId, caseKeyId, title),
            authority: await this.vault.sealOrNull(cabinetId, caseKeyId, authority),
            caseNumber: await this.vault.sealOrNull(cabinetId, caseKeyId, first('CASE_NUMBER')),
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

  // ---------- Название ----------

  /** Поправка 8 (23.11): человек меняет название письма. Чужое письмо: 404. */
  async rename(
    cabinetId: string,
    letterId: string,
    input: RenameLetterInput,
  ): Promise<LetterDetail> {
    const letter = await this.db.letter.findFirst({
      where: { id: letterId, cabinetId },
      select: { keyId: true },
    });
    if (!letter) throw new ApiError('NOT_FOUND');
    const res = await this.db.letter.updateMany({
      where: { id: letterId, cabinetId },
      data: { title: await this.vault.seal(cabinetId, letter.keyId, input.title) },
    });
    if (res.count !== 1) throw new ApiError('NOT_FOUND');
    return this.detail(cabinetId, letterId);
  }

  // ---------- Общее ----------

  private async ownLetter(tx: Tx, cabinetId: string, letterId: string) {
    const letter = await tx.letter.findFirst({
      where: { id: letterId, cabinetId },
      select: { id: true, caseId: true, keyId: true },
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
  relative: boolean;
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
    relativeDeadline: c.relative,
  };
}

/**
 * Поправка 8: название от модели берётся, только если его цитата стоит в тексте письма
 * (пробелы и регистр не важны: текст фото распознан моделью).
 */
export function verifiedTitle(
  title: { value: string; quote: string } | null,
  text: string,
): string | null {
  if (!title) return null;
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!norm(text).includes(norm(title.quote))) return null;
  const value = title.value.replace(/\s+/g, ' ').trim();
  return value ? value.slice(0, 80) : null;
}

function toLetterView(row: {
  id: string;
  keyId: string | null;
  title: string | null;
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
    keyId: row.keyId,
    title: row.title,
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
