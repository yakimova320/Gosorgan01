import { Inject, Injectable } from '@nestjs/common';
import { ProfileSchema } from '@jasno/shared';
import { createHash } from 'node:crypto';
import {
  ClaimsService,
  type ConfirmedClaim,
} from '../claims/claims.service.js';
import { ApiError } from '../common/api-error.js';
import { berlinToday, toIsoDate } from '../common/berlin-date.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateDraftInput,
  DraftQuestions,
  DraftView,
} from './drafts.dto.js';
import {
  availableQuestions,
  deAmount,
  QUESTIONS,
  type QuestionId,
} from './questions.js';
import {
  buildClarification,
  type SenderProfile,
} from './templates/clarification.js';
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
  letterId: string;
  questionId: QuestionId;
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

    const confirmed = await this.claims.getConfirmed(
      cabinetId,
      caseId,
      input.letterId,
    );
    if (confirmed.length === 0) throw new ApiError('NO_CONFIRMED_CLAIMS');
    if (!availableQuestions(confirmed).includes(input.questionId))
      throw new ApiError('QUESTION_NOT_AVAILABLE', {
        questionId: input.questionId,
      });
    const amountClaimId = this.pickAmount(
      confirmed,
      input.questionId,
      input.amountClaimId,
    );
    const profile = await this.profile(cabinetId);

    const today = toIsoDate(berlinToday());
    const built = buildClarification({
      claims: confirmed,
      profile,
      questionId: input.questionId,
      amountClaimId,
      today,
    });
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
        questionId: input.questionId,
        claims: Object.fromEntries(
          confirmed
            .filter((c) => built.claimIds.includes(c.id))
            .map((c) => [c.id, c.value]),
        ),
      };
      const created = await tx.draft.create({
        data: {
          caseId,
          kind: 'CLARIFICATION',
          templateId: `clarification.${input.questionId}`,
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
    return {
      letterId,
      caseId: letter.caseId,
      questions: availableQuestions(confirmed).map((id) => ({
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
  verification: unknown;
  createdAt: Date;
}): DraftView {
  const snap = (d.claimSnapshot ?? {}) as Partial<SnapshotJson>;
  return {
    id: d.id,
    caseId: d.caseId,
    letterId: snap.letterId ?? null,
    questionId: snap.questionId ?? null,
    kind: d.kind,
    germanText: d.germanText,
    russianText: d.russianText,
    claimIds: (d.claimIds as string[]) ?? [],
    stale: d.stale,
    status: d.status,
    verification: d.verification as VerificationReport,
    createdAt: d.createdAt.toISOString(),
  };
}
