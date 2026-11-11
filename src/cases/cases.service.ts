import { Inject } from '@nestjs/common';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service.js';
import { TimelineService } from './timeline.service.js';
import type { ConfirmedClaim, NewClaim } from './types.js';
import type { ExtractedLetter } from '../extraction/schemas.js';
import type { ParsedDocument } from '../documents/types.js';
@Injectable()
export class CasesService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(TimelineService) private readonly timeline: TimelineService,
  ) {}
  create(title: string) {
    return this.db.case.create({ data: { title } });
  }
  async require(id: string) {
    const result = await this.db.case.findUnique({ where: { id } });
    if (!result) throw new NotFoundException('Дело не найдено');
    return result;
  }
  async state(id: string) {
    const result = await this.db.case.findUnique({
      where: { id },
      include: {
        letters: { orderBy: { createdAt: 'asc' } },
        claims: { orderBy: { createdAt: 'asc' } },
        deadlines: { include: { claim: true } },
        events: true,
        messages: true,
        drafts: true,
        suggestions: true,
        targetSuggestions: true,
      },
    });
    if (!result) throw new NotFoundException('Дело не найдено');
    return {
      ...result,
      ...this.timeline.build(
        result.events,
        result.deadlines,
        result.claims,
        result.letters,
      ),
    };
  }
  async saveLetter(
    caseId: string,
    document: ParsedDocument,
    extracted: ExtractedLetter,
  ) {
    await this.require(caseId);
    return this.db.$transaction(async (tx) => {
      const letter = await tx.letter.create({
        data: {
          caseId,
          rawText: document.text,
          sourceType: document.sourceType,
          ocrConfidence: document.ocrConfidence ?? null,
          authority: extracted.authority.value,
          caseNumber: extracted.caseNumber.value,
          letterDate: extracted.letterDate.value,
          extraction: extracted as Prisma.InputJsonValue,
        },
      });
      const fields: [string, ExtractedLetter['authority']][] = [
        ['authority', extracted.authority],
        ['caseNumber', extracted.caseNumber],
        ['letterDate', extracted.letterDate],
        ...extracted.requirements.map(
          (f): [string, ExtractedLetter['authority']] => ['requirement', f],
        ),
      ];
      for (const [topic, field] of fields) {
        if (!field.value || !field.quote) continue;
        await tx.claim.create({
          data: {
            caseId,
            letterId: letter.id,
            text: field.value,
            topic,
            basis: 'DOCUMENT',
            quote: field.quote,
            page: field.page,
            confidence: field.confidence,
          },
        });
      }
      for (const d of extracted.deadlines) {
        const claim = await tx.claim.create({
          data: {
            caseId,
            letterId: letter.id,
            text: d.date,
            topic: 'deadline',
            basis: 'DOCUMENT',
            quote: d.quote,
            page: d.page,
            confidence: d.confidence,
          },
        });
        await tx.deadline.create({
          data: {
            caseId,
            date: new Date(d.date),
            kind: d.kind,
            claimId: claim.id,
          },
        });
      }
      await tx.event.create({
        data: {
          caseId,
          type: 'LETTER_RECEIVED',
          details: { letterId: letter.id },
        },
      });
      // Suggestions are created in the same transaction as the letter; nothing is moved automatically.
      if (letter.caseNumber) {
        const matches = await tx.letter.findMany({
          where: { caseNumber: letter.caseNumber, caseId: { not: caseId } },
          select: { caseId: true },
          distinct: ['caseId'],
        });
        for (const match of matches)
          await tx.linkSuggestion.create({
            data: { caseId, letterId: letter.id, targetCaseId: match.caseId },
          });
      }
      return {
        letter,
        extracted,
        linkSuggestions: await tx.linkSuggestion.findMany({
          where: { letterId: letter.id },
        }),
      };
    });
  }
  async getConfirmedClaims(caseId: string): Promise<ConfirmedClaim[]> {
    await this.require(caseId);
    const claims = await this.db.claim.findMany({
      where: { caseId, status: 'CONFIRMED' },
    });
    return claims as ConfirmedClaim[];
  }
  async confirmClaim(caseId: string, claimId: string) {
    return this.db.$transaction(async (tx) => {
      const claim = await tx.claim.findFirst({
        where: { id: claimId, caseId },
      });
      if (!claim) throw new NotFoundException('Утверждение не найдено');
      if (claim.status !== 'UNCONFIRMED')
        throw new ConflictException(
          'Утверждение уже подтверждено или пересмотрено',
        );
      if (claim.basis !== 'DOCUMENT' || !claim.quote || !claim.letterId)
        throw new UnprocessableEntityException(
          'Слова пользователя требуют подтверждения документом',
        );
      const changed = await tx.claim.updateMany({
        where: { id: claimId, caseId, status: 'UNCONFIRMED' },
        data: { status: 'CONFIRMED' },
      });
      if (changed.count !== 1)
        throw new ConflictException('Статус утверждения изменился');
      await tx.event.create({
        data: { caseId, type: 'CLAIM_CONFIRMED', details: { claimId } },
      });
      return tx.claim.findUniqueOrThrow({ where: { id: claimId } });
    });
  }
  async saveDialogue(
    caseId: string,
    text: string,
    claims: NewClaim[],
    questions: string[],
  ) {
    await this.require(caseId);
    return this.db.$transaction(async (tx) => {
      await tx.message.create({ data: { caseId, role: 'USER', text } });
      for (const c of claims)
        await tx.claim.create({
          data: {
            caseId,
            text: c.text,
            topic: c.topic,
            basis: 'USER',
            status: 'UNCONFIRMED',
          },
        });
      await tx.message.create({
        data: { caseId, role: 'ASSISTANT', text: questions.join('\n') },
      });
      await tx.event.create({
        data: {
          caseId,
          type: 'USER_REPORTED_SENT',
          details: { claims: claims.map((c) => c.text) },
        },
      });
    });
  }
  async supersedeClaims(
    caseId: string,
    replacements: { oldId: string; newId: string; reason: string }[],
  ) {
    return this.db.$transaction(async (tx) => {
      for (const r of replacements) {
        const replacement = await tx.claim.findFirst({
          where: {
            id: r.newId,
            caseId,
            basis: 'DOCUMENT',
            status: 'CONFIRMED',
          },
        });
        if (!replacement)
          throw new ConflictException('Новый документ ещё не подтверждён');
        const updated = await tx.claim.updateMany({
          where: {
            id: r.oldId,
            caseId,
            status: { in: ['CONFIRMED', 'UNCONFIRMED'] },
          },
          data: {
            status: 'SUPERSEDED',
            supersededById: r.newId,
            reason: r.reason,
          },
        });
        if (updated.count)
          await tx.event.create({
            data: { caseId, type: 'REVISION', details: r },
          });
      }
    });
  }
  async confirmLink(caseId: string, linkId: string) {
    return this.db.$transaction(async (tx) => {
      const link = await tx.linkSuggestion.findFirst({
        where: { id: linkId, caseId },
      });
      if (!link) throw new NotFoundException('Предложение связи не найдено');
      if (link.status !== 'PENDING')
        throw new ConflictException('Связь уже обработана');
      const changed = await tx.linkSuggestion.updateMany({
        where: { id: linkId, status: 'PENDING' },
        data: { status: 'CONFIRMED' },
      });
      if (changed.count !== 1)
        throw new ConflictException('Связь уже обработана');
      await tx.letter.update({
        where: { id: link.letterId },
        data: { caseId: link.targetCaseId },
      });
      await tx.claim.updateMany({
        where: { letterId: link.letterId },
        data: { caseId: link.targetCaseId },
      });
      const moved = await tx.claim.findMany({
        where: { letterId: link.letterId },
        select: { id: true },
      });
      await tx.deadline.updateMany({
        where: { claimId: { in: moved.map((c) => c.id) } },
        data: { caseId: link.targetCaseId },
      });
      await tx.linkSuggestion.updateMany({
        where: {
          letterId: link.letterId,
          id: { not: linkId },
          status: 'PENDING',
        },
        data: { status: 'REJECTED' },
      });
      await tx.event.create({
        data: {
          caseId: link.targetCaseId,
          type: 'LINK_CONFIRMED',
          details: { linkId, sourceCaseId: caseId, letterId: link.letterId },
        },
      });
      return link.targetCaseId;
    });
  }
  async saveDraft(
    caseId: string,
    draft: {
      germanText: string;
      russianExplanation: string;
      usedClaimIds: string[];
    },
  ) {
    return this.db.$transaction(async (tx) => {
      const active = await tx.claim.count({
        where: { caseId, id: { in: draft.usedClaimIds }, status: 'CONFIRMED' },
      });
      if (active !== new Set(draft.usedClaimIds).size)
        throw new ConflictException(
          'Факты изменились; создайте черновик заново',
        );
      return tx.draft.create({
        data: {
          caseId,
          germanText: draft.germanText,
          russianExplanation: draft.russianExplanation,
          claimIds: draft.usedClaimIds,
        },
      });
    });
  }
  recordCall(data: Prisma.LlmCallUncheckedCreateInput) {
    return this.db.llmCall.create({ data });
  }
  async trace(caseId: string) {
    await this.require(caseId);
    return this.db.llmCall.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
