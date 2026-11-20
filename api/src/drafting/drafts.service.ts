import { Inject, Injectable } from '@nestjs/common';
import {
  formatIban,
  OUTGOING_TEMPLATES,
  outgoingTemplate,
  ProfileSchema,
  type OutgoingInput,
  type OutgoingTemplate,
  type OutgoingTemplateId,
} from '@jasno/shared';
import { createHash } from 'node:crypto';
import {
  ClaimsService,
  type ConfirmedClaim,
} from '../claims/claims.service.js';
import { ApiError } from '../common/api-error.js';
import { berlinToday, toIsoDate } from '../common/berlin-date.js';
import { lockActiveCabinet } from '../erasure/cabinet-lock.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { buildLetterPdf } from './letter-pdf.js';
import type {
  CreateDraftInput,
  DraftQuestions,
  DraftView,
  EditDraftInput,
  OutgoingResult,
  ReportSentInput,
  ReportSentResult,
} from './drafts.dto.js';
import {
  availableQuestions,
  deAmount,
  QUESTIONS,
  type QuestionId,
} from './questions.js';
import {
  buildClarification,
  type BuiltDraft,
  type SenderProfile,
} from './templates/clarification.js';
import {
  availableReplyKinds,
  buildReply,
  EXTENSION_REASONS,
  extendableDeadlines,
  type ExtensionReason,
} from './templates/replies.js';
import { buildOutgoing } from './templates/outgoing.js';
import {
  verifyDraft,
  type VerificationReport,
  type VerifyInput,
} from './verification.js';

/** Консультации из FAQ, без адресов и цен (ТЗ v4 раздел 11, пункт 4). */
export const CONSULTATIONS = [
  'Migrationsberatung für erwachsene Zuwanderer (MBE)',
  'Verbraucherzentrale',
  'Mieterverein',
  'Адвокат; при низком доходе — Beratungshilfeschein в Amtsgericht',
];

@Injectable()
export class VerificationService {
  /** Асинхронно: между сборкой и сохранением может пройти время; это место проверяют тесты. */
  async verify(input: VerifyInput): Promise<VerificationReport> {
    return verifyDraft(input);
  }
}

interface SnapshotJson {
  /** нет у своего письма (B16) */
  letterId?: string;
  /** B16: шаблон своего письма и факт каждого поля */
  outgoing?: { templateId: OutgoingTemplateId; keys: Record<string, string> };
  questionId?: QuestionId;
  /** B12, EXTENSION */
  reason?: ExtensionReason;
  deadlineClaimId?: string;
  claims: Record<string, string>;
}

/** Черновики (B10): шаблон из подтверждённых фактов одного письма, проверка, сохранение одной транзакцией. */
@Injectable()
export class DraftsService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ClaimsService) private readonly claims: ClaimsService,
    @Inject(VerificationService)
    private readonly verification: VerificationService,
  ) {}

  async create(
    cabinetId: string,
    caseId: string,
    input: CreateDraftInput,
  ): Promise<DraftView> {
    const kase = await this.db.case.findFirst({
      where: { id: caseId, cabinetId },
      select: { id: true },
    });
    if (!kase) throw new ApiError('NOT_FOUND');
    if (input.kind === 'WIDERSPRUCH')
      throw new ApiError('LEGAL_REFERRAL', { places: CONSULTATIONS });
    if (input.kind === 'TEMPLATE') return this.rebuildOutgoing(cabinetId, caseId);

    const confirmed = await this.claims.getConfirmed(
      cabinetId,
      caseId,
      input.letterId,
    );
    if (confirmed.length === 0) throw new ApiError('NO_CONFIRMED_CLAIMS');
    const today = toIsoDate(berlinToday());
    const profile = await this.profile(cabinetId);

    let built: BuiltDraft;
    let options: Omit<SnapshotJson, 'letterId' | 'claims'>;
    let templateId: string;
    if (input.kind === 'CLARIFICATION') {
      if (!availableQuestions(confirmed).includes(input.questionId))
        throw new ApiError('QUESTION_NOT_AVAILABLE', {
          questionId: input.questionId,
        });
      const amountClaimId = this.pickAmount(
        confirmed,
        input.questionId,
        input.amountClaimId,
      );
      built = buildClarification({
        claims: confirmed,
        profile,
        questionId: input.questionId,
        amountClaimId,
        today,
      });
      options = { questionId: input.questionId };
      templateId = `clarification.${input.questionId}`;
    } else {
      // B12: вид ответа доступен только по подтверждённым фактам этого письма
      if (!availableReplyKinds(confirmed, today).includes(input.kind))
        throw new ApiError('QUESTION_NOT_AVAILABLE', { kind: input.kind });
      const deadlineClaimId =
        input.kind === 'EXTENSION'
          ? this.pickDeadline(confirmed, today, input.deadlineClaimId)
          : undefined;
      const reason = input.kind === 'EXTENSION' ? input.reason : undefined;
      built = buildReply({
        kind: input.kind,
        claims: confirmed,
        profile,
        today,
        deadlineClaimId,
        extensionReason: reason,
      });
      options = {
        ...(reason ? { reason } : {}),
        ...(deadlineClaimId ? { deadlineClaimId } : {}),
      };
      templateId = `${input.kind.toLowerCase()}${reason ? `.${reason}` : ''}`;
    }
    const report = await this.verification.verify({
      ...built,
      confirmed,
      profile,
      today,
    });
    if (!report.passed) throw new ApiError('DRAFT_VERIFICATION_FAILED', report);
    const version = sourcesVersion(confirmed, profile);

    const draft = await this.db.$transaction(async (tx) => {
      // Факты или профиль изменились, пока собирался черновик: не сохранять.
      const nowClaims = await tx.claim.findMany({
        where: {
          letterId: input.letterId,
          status: 'CONFIRMED',
          letter: { caseId, cabinetId },
        },
        select: {
          id: true,
          letterId: true,
          kind: true,
          value: true,
          quote: true,
        },
      });
      const nowProfile = await tx.cabinet.findUniqueOrThrow({
        where: { id: cabinetId },
        select: { profile: true },
      });
      const parsed = ProfileSchema.safeParse(nowProfile.profile);
      if (
        !parsed.success ||
        sourcesVersion(
          nowClaims.map((c) => ({
            ...c,
            letterId: c.letterId!,
          })) as ConfirmedClaim[],
          parsed.data,
        ) !== version
      )
        throw new ApiError('DRAFT_SOURCES_CHANGED');

      const snapshot: SnapshotJson = {
        letterId: input.letterId,
        ...options,
        claims: Object.fromEntries(
          confirmed
            .filter((c) => built.claimIds.includes(c.id))
            .map((c) => [c.id, c.value]),
        ),
      };
      const created = await tx.draft.create({
        data: {
          caseId,
          kind: input.kind,
          templateId,
          germanText: built.germanText,
          russianText: built.russianText,
          claimIds: built.claimIds,
          claimSnapshot: snapshot as unknown as object,
          verification: report as unknown as object,
        },
      });
      await tx.event.create({
        data: {
          caseId,
          type: 'DRAFT_PREPARED',
          details: { draftId: created.id, letterId: input.letterId },
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: { updatedAt: new Date() },
      });
      return created;
    });
    return toView(draft);
  }

  async get(cabinetId: string, draftId: string): Promise<DraftView> {
    const draft = await this.db.draft.findFirst({
      where: { id: draftId, case: { cabinetId } },
    });
    if (!draft) throw new ApiError('NOT_FOUND');
    return toView(draft);
  }

  /**
   * B12: правка черновика человеком. Оба текста проверяются заново по тем же источникам
   * (подтверждённые факты письма, профиль, дата создания); без пройденной проверки ничего не сохраняется.
   * Отправленный и устаревший черновик не правится.
   */
  async edit(
    cabinetId: string,
    draftId: string,
    input: EditDraftInput,
  ): Promise<DraftView> {
    const draft = await this.db.draft.findFirst({
      where: { id: draftId, case: { cabinetId } },
    });
    if (!draft) throw new ApiError('NOT_FOUND');
    if (draft.status === 'SENT') throw new ApiError('DRAFT_ALREADY_SENT');
    if (draft.stale) throw new ApiError('DRAFT_STALE');
    const snap = (draft.claimSnapshot ?? {}) as Partial<SnapshotJson>;
    let confirmed: ConfirmedClaim[];
    if (snap.outgoing)
      confirmed = await this.claims.getConfirmedOutgoing(cabinetId, draft.caseId);
    else if (snap.letterId)
      confirmed = await this.claims.getConfirmed(
        cabinetId,
        draft.caseId,
        snap.letterId,
      );
    else throw new ApiError('DRAFT_STALE');
    const profile = await this.profile(cabinetId);
    // «Datum:» в тексте — дата сборки: она и есть разрешённая дата создания
    const created = toIsoDate(berlinToday(draft.createdAt));
    const report = await this.verification.verify({
      germanText: input.germanText,
      russianText: input.russianText,
      claimIds: (draft.claimIds as string[]) ?? [],
      confirmed,
      profile,
      today: created,
    });
    if (!report.passed) throw new ApiError('DRAFT_VERIFICATION_FAILED', report);

    // Условное обновление: черновик не устарел и не отправлен, пока шла проверка.
    const updated = await this.db.$transaction(async (tx) => {
      const res = await tx.draft.updateMany({
        where: { id: draftId, status: 'PREPARED', stale: false },
        data: {
          germanText: input.germanText,
          russianText: input.russianText,
          verification: { ...report, edited: true } as unknown as object,
        },
      });
      if (res.count !== 1) throw new ApiError('DRAFT_STALE');
      return tx.draft.findUniqueOrThrow({ where: { id: draftId } });
    });
    return toView(updated);
  }

  /**
   * B12: «Я отправил(а)». Записывает канал, дату и черновик; закрывает только явно выбранный срок.
   * Одна транзакция: черновик SENT, события USER_REPORTED_SENT и DEADLINE_DONE.
   */
  async reportSent(
    cabinetId: string,
    caseId: string,
    input: ReportSentInput,
  ): Promise<ReportSentResult> {
    const kase = await this.db.case.findFirst({
      where: { id: caseId, cabinetId },
      select: { id: true },
    });
    if (!kase) throw new ApiError('NOT_FOUND');
    if (input.date > toIsoDate(berlinToday()))
      throw new ApiError('VALIDATION_FAILED', {
        fields: { date: 'Дата отправки не может быть в будущем' },
      });
    const sentAt = new Date(`${input.date}T00:00:00.000Z`);

    await this.db.$transaction(async (tx) => {
      if (input.draftId) {
        const draft = await tx.draft.findFirst({
          where: { id: input.draftId, caseId },
          select: { status: true },
        });
        if (!draft) throw new ApiError('NOT_FOUND');
        const res = await tx.draft.updateMany({
          where: { id: input.draftId, caseId, status: 'PREPARED' },
          data: { status: 'SENT', sentAt, sentVia: input.via },
        });
        if (res.count !== 1) throw new ApiError('DRAFT_ALREADY_SENT');
      }
      if (input.closeDeadlineId) {
        const deadline = await tx.deadline.findFirst({
          where: { id: input.closeDeadlineId, caseId },
          select: { doneAt: true, claim: { select: { status: true } } },
        });
        if (!deadline) throw new ApiError('NOT_FOUND');
        if (deadline.claim.status !== 'CONFIRMED')
          throw new ApiError('DEADLINE_NOT_CONFIRMED');
        const res = await tx.deadline.updateMany({
          where: { id: input.closeDeadlineId, caseId, doneAt: null },
          data: { doneAt: new Date() },
        });
        if (res.count !== 1) throw new ApiError('DEADLINE_ALREADY_DONE');
      }
      await tx.event.create({
        data: {
          caseId,
          type: 'USER_REPORTED_SENT',
          details: {
            via: input.via,
            date: input.date,
            ...(input.draftId ? { draftId: input.draftId } : {}),
          },
        },
      });
      if (input.closeDeadlineId)
        await tx.event.create({
          data: {
            caseId,
            type: 'DEADLINE_DONE',
            details: { deadlineId: input.closeDeadlineId },
          },
        });
      await tx.case.update({
        where: { id: caseId },
        data: { updatedAt: new Date() },
      });
    });
    return {
      caseId,
      draftId: input.draftId ?? null,
      closedDeadlineId: input.closeDeadlineId ?? null,
    };
  }

  /**
   * B15: PDF письма для печати — немецкий текст проверенного черновика. Устаревший черновик
   * не печатается (409 DRAFT_STALE): в PDF не должны попасть изменившиеся факты или профиль.
   */
  async pdf(cabinetId: string, draftId: string): Promise<Buffer> {
    const draft = await this.db.draft.findFirst({
      where: { id: draftId, case: { cabinetId } },
      select: { germanText: true, stale: true },
    });
    if (!draft) throw new ApiError('NOT_FOUND');
    if (draft.stale) throw new ApiError('DRAFT_STALE');
    return buildLetterPdf({ germanText: draft.germanText });
  }

  /** B16: каталог шаблонов своих писем (GET /templates). */
  templates(): OutgoingTemplate[] {
    return OUTGOING_TEMPLATES;
  }

  /**
   * B16: своё письмо (POST /outgoing). Поля формы человек проверил на экране проверки и подтвердил
   * нажатием «Всё верно»: они сохраняются как подтверждённые факты дела (basis USER) и становятся
   * единственным источником черновика, как факты письма у ответов. Одна транзакция: дело OUTGOING,
   * факты, черновик, событие. Не прошла проверка — не сохраняется ничего.
   */
  async createOutgoing(
    cabinetId: string,
    input: OutgoingInput,
  ): Promise<OutgoingResult> {
    const template = outgoingTemplate(input.templateId)!;
    const today = toIsoDate(berlinToday());
    const fields = Object.fromEntries(
      Object.entries(input.fields)
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([, v]) => v !== ''),
    );
    const dateErrors = outgoingDateErrors(input.templateId, fields, today);
    if (Object.keys(dateErrors).length)
      throw new ApiError('VALIDATION_FAILED', { fields: dateErrors });
    const profile = await this.profile(cabinetId);

    return this.db.$transaction(async (tx) => {
      // A01: во время удаления аккаунта новых строк у кабинета не появляется
      if (!(await lockActiveCabinet(tx, cabinetId)))
        throw new ApiError('ACCOUNT_DELETING');
      const kase = await tx.case.create({
        data: {
          cabinetId,
          origin: 'OUTGOING',
          title: `${template.titleRu}: ${input.recipient.name}`,
          authority: input.recipient.name,
          caseNumber: fields.reference ?? null,
        },
        select: { id: true },
      });
      const rows: { key: string; kind: ConfirmedClaim['kind']; value: string; text: string }[] = [
        {
          key: 'recipient.name',
          kind: 'AUTHORITY',
          value: input.recipient.name,
          text: `Адресат: ${input.recipient.name}`,
        },
        {
          key: 'recipient.address',
          kind: 'OTHER',
          value: input.recipient.address.replace(/\r\n?/g, '\n'),
          text: `Адрес адресата: ${input.recipient.address.replace(/\s*\r?\n\s*/g, ', ')}`,
        },
        ...template.fields
          .filter((f) => fields[f.key] !== undefined)
          .map((f) => {
            const raw = fields[f.key];
            const value = f.type === 'iban' ? formatIban(raw) : raw;
            const shown =
              f.type === 'date'
                ? raw.split('-').reverse().join('.')
                : f.type === 'select'
                  ? (f.options?.find((o) => o.id === raw)?.ru ?? raw)
                  : value;
            return {
              key: f.key,
              kind: (f.type === 'reference' ? 'CASE_NUMBER' : 'OTHER') as ConfirmedClaim['kind'],
              value,
              text: `${f.labelRu}: ${shown}`,
            };
          }),
      ];
      const claims: Record<string, ConfirmedClaim> = {};
      for (const r of rows) {
        const claim = await tx.claim.create({
          data: {
            caseId: kase.id,
            kind: r.kind,
            value: r.value,
            text: r.text,
            basis: 'USER',
            status: 'CONFIRMED',
            updatedBy: 'USER',
          },
          select: { id: true, letterId: true, kind: true, value: true, quote: true, text: true },
        });
        const { text, ...rest } = claim;
        claims[r.key] = { ...rest, label: text };
      }
      const draft = await this.saveOutgoingDraft(tx, {
        caseId: kase.id,
        templateId: input.templateId,
        claims,
        profile,
        today,
      });
      return { caseId: kase.id, draft };
    });
  }

  /** B16: «Собрать заново» своего письма — тот же шаблон, подтверждённые поля дела, свежий профиль. */
  private async rebuildOutgoing(
    cabinetId: string,
    caseId: string,
  ): Promise<DraftView> {
    const confirmed = await this.claims.getConfirmedOutgoing(cabinetId, caseId);
    const last = await this.db.draft.findFirst({
      where: { caseId, kind: 'TEMPLATE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { claimSnapshot: true },
    });
    const snap = (last?.claimSnapshot ?? {}) as Partial<SnapshotJson>;
    if (!snap.outgoing) throw new ApiError('NO_CONFIRMED_CLAIMS');
    const byId = new Map(confirmed.map((c) => [c.id, c]));
    const claims: Record<string, ConfirmedClaim> = {};
    for (const [key, id] of Object.entries(snap.outgoing.keys)) {
      const c = byId.get(id);
      if (!c) throw new ApiError('NO_CONFIRMED_CLAIMS');
      claims[key] = c;
    }
    const profile = await this.profile(cabinetId);
    const today = toIsoDate(berlinToday());
    const version = sourcesVersion(Object.values(claims), profile);
    return this.db.$transaction(async (tx) => {
      // Профиль или факты изменились, пока собирался черновик: не сохранять.
      const nowProfile = await tx.cabinet.findUniqueOrThrow({
        where: { id: cabinetId },
        select: { profile: true },
      });
      const nowClaims = await tx.claim.findMany({
        where: { id: { in: Object.values(claims).map((c) => c.id) }, caseId, status: 'CONFIRMED' },
        select: { id: true, letterId: true, kind: true, value: true, quote: true },
      });
      const parsed = ProfileSchema.safeParse(nowProfile.profile);
      if (
        !parsed.success ||
        sourcesVersion(nowClaims as ConfirmedClaim[], parsed.data) !== version
      )
        throw new ApiError('DRAFT_SOURCES_CHANGED');
      return this.saveOutgoingDraft(tx, {
        caseId,
        templateId: snap.outgoing!.templateId,
        claims,
        profile,
        today,
      });
    });
  }

  private async saveOutgoingDraft(
    tx: Prisma.TransactionClient,
    a: {
      caseId: string;
      templateId: OutgoingTemplateId;
      claims: Record<string, ConfirmedClaim>;
      profile: SenderProfile;
      today: string;
    },
  ): Promise<DraftView> {
    const built = buildOutgoing({
      templateId: a.templateId,
      claims: a.claims,
      profile: a.profile,
      today: a.today,
    });
    const confirmed = Object.values(a.claims);
    const report = await this.verification.verify({
      ...built,
      confirmed,
      profile: a.profile,
      today: a.today,
    });
    if (!report.passed) throw new ApiError('DRAFT_VERIFICATION_FAILED', report);
    const snapshot: SnapshotJson = {
      outgoing: {
        templateId: a.templateId,
        keys: Object.fromEntries(Object.entries(a.claims).map(([k, c]) => [k, c.id])),
      },
      claims: Object.fromEntries(confirmed.map((c) => [c.id, c.value])),
    };
    const created = await tx.draft.create({
      data: {
        caseId: a.caseId,
        kind: 'TEMPLATE',
        templateId: `outgoing.${a.templateId}`,
        germanText: built.germanText,
        russianText: built.russianText,
        claimIds: built.claimIds,
        claimSnapshot: snapshot as unknown as object,
        verification: report as unknown as object,
      },
    });
    await tx.event.create({
      data: {
        caseId: a.caseId,
        type: 'DRAFT_PREPARED',
        details: { draftId: created.id, outgoing: a.templateId },
      },
    });
    await tx.case.update({
      where: { id: a.caseId },
      data: { updatedAt: new Date() },
    });
    return toView(created);
  }

  /** Какие вопросы доступны для письма (для экрана черновика, F04). */
  async questions(
    cabinetId: string,
    letterId: string,
  ): Promise<DraftQuestions> {
    const letter = await this.db.letter.findFirst({
      where: { id: letterId, cabinetId },
      select: { caseId: true },
    });
    if (!letter?.caseId) throw new ApiError('NOT_FOUND');
    const confirmed = await this.claims.getConfirmed(
      cabinetId,
      letter.caseId,
      letterId,
    );
    const amounts = confirmed.filter((c) => c.kind === 'AMOUNT');
    const today = toIsoDate(berlinToday());
    const questionIds = availableQuestions(confirmed);
    return {
      kinds: [
        ...(questionIds.length > 0 ? (['CLARIFICATION'] as const) : []),
        ...availableReplyKinds(confirmed, today),
      ],
      deadlines: extendableDeadlines(confirmed, today).map((d) => ({
        claimId: d.id,
        date: d.value,
      })),
      extensionReasons: (
        Object.keys(EXTENSION_REASONS) as ExtensionReason[]
      ).map((id) => ({ id, ru: EXTENSION_REASONS[id].ru })),
      letterId,
      caseId: letter.caseId,
      questions: questionIds.map((id) => ({
        id,
        ru: QUESTIONS[id].ru(
          id === 'AMOUNT' && amounts.length === 1
            ? deAmount(amounts[0].value)
            : '…',
        ),
      })),
      amounts: amounts.map((a) => ({ claimId: a.id, value: a.value })),
    };
  }

  /** EXTENSION: выбранный срок письма; при нескольких сроках выбор обязателен. */
  private pickDeadline(
    confirmed: ConfirmedClaim[],
    today: string,
    deadlineClaimId?: string,
  ): string {
    const deadlines = extendableDeadlines(confirmed, today);
    if (deadlineClaimId) {
      if (!deadlines.some((d) => d.id === deadlineClaimId))
        throw new ApiError('QUESTION_NOT_AVAILABLE', { deadlineClaimId });
      return deadlineClaimId;
    }
    if (deadlines.length === 1) return deadlines[0].id;
    throw new ApiError('VALIDATION_FAILED', {
      fields: { deadlineClaimId: 'Выберите срок, который нужно продлить' },
    });
  }

  /** Сумма для вопроса AMOUNT: выбранный факт этого письма; при нескольких суммах выбор обязателен. */
  private pickAmount(
    confirmed: ConfirmedClaim[],
    questionId: QuestionId,
    amountClaimId?: string,
  ): string | undefined {
    if (questionId !== 'AMOUNT') return undefined;
    const amounts = confirmed.filter((c) => c.kind === 'AMOUNT');
    if (amountClaimId) {
      if (!amounts.some((a) => a.id === amountClaimId))
        throw new ApiError('QUESTION_NOT_AVAILABLE', { amountClaimId });
      return amountClaimId;
    }
    if (amounts.length === 1) return amounts[0].id;
    throw new ApiError('VALIDATION_FAILED', {
      fields: { amountClaimId: 'Выберите сумму, о которой спросить' },
    });
  }

  private async profile(cabinetId: string): Promise<SenderProfile> {
    const cabinet = await this.db.cabinet.findUniqueOrThrow({
      where: { id: cabinetId },
      select: { profile: true },
    });
    const parsed = ProfileSchema.safeParse(cabinet.profile);
    if (!parsed.success) throw new ApiError('PROFILE_INCOMPLETE');
    return parsed.data;
  }
}

function sourcesVersion(
  claims: ConfirmedClaim[],
  profile: SenderProfile,
): string {
  const rows = claims.map((c) => `${c.id}|${c.value}`).sort();
  rows.push(
    `profile|${profile.firstName}|${profile.lastName}|${profile.address}`,
    `numbers|${JSON.stringify(profile.numbers ?? [])}`,
  );
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

function toView(d: {
  id: string;
  caseId: string;
  kind: string;
  germanText: string;
  russianText: string;
  claimIds: unknown;
  claimSnapshot: unknown;
  stale: boolean;
  status: string;
  sentAt: Date | null;
  sentVia: string | null;
  verification: unknown;
  createdAt: Date;
}): DraftView {
  const snap = (d.claimSnapshot ?? {}) as Partial<SnapshotJson>;
  const verification = d.verification as VerificationReport & {
    edited?: boolean;
  };
  return {
    id: d.id,
    caseId: d.caseId,
    letterId: snap.letterId ?? null,
    questionId: snap.questionId ?? null,
    kind: d.kind,
    reason: snap.reason ?? null,
    deadlineClaimId: snap.deadlineClaimId ?? null,
    outgoingTemplateId: snap.outgoing?.templateId ?? null,
    germanText: d.germanText,
    russianText: d.russianText,
    claimIds: (d.claimIds as string[]) ?? [],
    stale: d.stale,
    edited: verification.edited === true,
    status: d.status,
    sentAt: d.sentAt ? d.sentAt.toISOString().slice(0, 10) : null,
    sentVia: d.sentVia,
    verification,
    createdAt: d.createdAt.toISOString(),
  };
}

/**
 * B16: даты своего письма относительно «сегодня» (Europe/Berlin). Проверяет только сервер:
 * срок, который просим продлить, и дата расторжения не в прошлом; поданное и обращение — не в будущем.
 */
export function outgoingDateErrors(
  templateId: OutgoingTemplateId,
  f: Record<string, string>,
  today: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const past = (k: string, message: string) => {
    if (f[k] && f[k] < today) out[`fields.${k}`] = message;
  };
  const future = (k: string, message: string) => {
    if (f[k] && f[k] > today) out[`fields.${k}`] = message;
  };
  switch (templateId) {
    case 'KUENDIGUNG':
      past('endDate', 'Дата расторжения не может быть в прошлом');
      break;
    case 'FRISTVERLAENGERUNG':
      past('deadline', 'Срок уже прошёл: продлить можно только будущий срок');
      future('letterDate', 'Дата письма не может быть в будущем');
      break;
    case 'SACHSTANDSANFRAGE':
      future('submitted', 'Дата подачи не может быть в будущем');
      break;
    case 'BESCHWERDE':
      future('since', 'Дата не может быть в будущем');
      break;
  }
  return out;
}
