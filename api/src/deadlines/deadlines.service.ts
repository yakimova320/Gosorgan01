import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { toIsoDate } from '../common/berlin-date.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { cabinetLanguage } from '../common/language.js';
import { caseLine, deadlineCheckNote, deadlineSummary } from './deadline-text.js';
import { buildIcs } from './ics.js';

export interface DeadlineState {
  id: string;
  caseId: string | null;
  date: string;
  done: boolean;
}

/**
 * B12: сроки. Отметка «выполнен» и файл календаря — только для подтверждённого срока владельца.
 * Чужой срок: 404.
 */
@Injectable()
export class DeadlinesService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  private async own(cabinetId: string, id: string) {
    const d = await this.db.deadline.findFirst({
      where: { id, letter: { cabinetId } },
      include: {
        claim: { select: { status: true } },
        case: { select: { title: true } },
        letter: {
          select: {
            claims: {
              where: { kind: 'AUTHORITY', status: 'CONFIRMED' },
              select: { value: true },
              take: 1,
            },
          },
        },
      },
    });
    if (!d) throw new ApiError('NOT_FOUND');
    return d;
  }

  async setDone(
    cabinetId: string,
    id: string,
    done: boolean,
  ): Promise<DeadlineState> {
    const d = await this.own(cabinetId, id);
    if (d.claim.status !== 'CONFIRMED')
      throw new ApiError('DEADLINE_NOT_CONFIRMED');
    if (done === (d.doneAt !== null))
      return { id, caseId: d.caseId, date: toIsoDate(d.date), done };
    await this.db.$transaction(async (tx) => {
      const res = await tx.deadline.updateMany({
        where: { id, doneAt: done ? null : { not: null } },
        data: { doneAt: done ? new Date() : null },
      });
      if (res.count !== 1 || !d.caseId) return;
      await tx.event.create({
        data: done
          ? { caseId: d.caseId, type: 'DEADLINE_DONE', details: { deadlineId: id } }
          : {
              caseId: d.caseId,
              type: 'REVISION',
              details: { deadlineId: id, text: 'Срок снова открыт' },
            },
      });
      await tx.case.update({
        where: { id: d.caseId },
        data: { updatedAt: new Date() },
      });
    });
    return { id, caseId: d.caseId, date: toIsoDate(d.date), done };
  }

  /** Файл .ics: событие на день срока и напоминание за remindDaysBefore дней. */
  async ics(cabinetId: string, id: string): Promise<string> {
    const d = await this.own(cabinetId, id);
    if (d.claim.status !== 'CONFIRMED')
      throw new ApiError('DEADLINE_NOT_CONFIRMED');
    const lang = await cabinetLanguage(this.db, cabinetId);
    return buildIcs({
      id: d.id,
      date: toIsoDate(d.date),
      summary: deadlineSummary(d.kind, d.letter.claims[0]?.value, lang),
      description: [
        d.case?.title ? caseLine(d.case.title, lang) : null,
        deadlineCheckNote(lang),
      ]
        .filter(Boolean)
        .join('\n'),
      remindDaysBefore: d.remindDaysBefore,
      now: new Date(),
    });
  }
}
