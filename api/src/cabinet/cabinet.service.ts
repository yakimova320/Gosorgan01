import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { ApiError } from '../common/api-error.js';
import { berlinToday, toIsoDate } from '../common/berlin-date.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ProfileSchema,
  type Profile,
  type UpdateCabinetInput,
} from './cabinet.schemas.js';

export interface CabinetView {
  email: string;
  language: string;
  profile: Profile | null;
  counts: { openTasks: number; activeCases: number; inboxLetters: number };
  nextDeadline: { date: string; caseId: string; title: string } | null;
}

/** Открытый срок: подтверждённый факт, не отмечен «сделано», дело не завершено. */
const openDeadline = (cabinetId: string): Prisma.DeadlineWhereInput => ({
  doneAt: null,
  claim: { status: 'CONFIRMED' },
  case: { cabinetId, status: 'OPEN' },
});

@Injectable()
export class CabinetService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  async get(cabinetId: string): Promise<CabinetView> {
    const cabinet = await this.db.cabinet.findUnique({
      where: { id: cabinetId },
    });
    if (!cabinet) throw new ApiError('NOT_FOUND');

    const [openTasks, activeCases, inboxLetters, next] = await Promise.all([
      this.db.deadline.count({ where: openDeadline(cabinetId) }),
      this.db.case.count({ where: { cabinetId, status: 'OPEN' } }),
      this.db.letter.count({ where: { cabinetId, caseId: null } }),
      this.db.deadline.findFirst({
        where: { ...openDeadline(cabinetId), date: { gte: berlinToday() } },
        orderBy: { date: 'asc' },
        include: { case: { select: { id: true, title: true } } },
      }),
    ]);

    return {
      email: cabinet.email,
      language: cabinet.language,
      profile: (cabinet.profile as Profile | null) ?? null,
      counts: { openTasks, activeCases, inboxLetters },
      nextDeadline:
        next && next.case
          ? {
              date: toIsoDate(next.date),
              caseId: next.case.id,
              title: next.case.title,
            }
          : null,
    };
  }

  async update(
    cabinetId: string,
    input: UpdateCabinetInput,
  ): Promise<CabinetView> {
    const data: Prisma.CabinetUpdateInput = {};
    if (input.language !== undefined) data.language = input.language;
    if (input.profile !== undefined) {
      // Частичное изменение: объединяем с сохранённым и проверяем итог целиком.
      const current = await this.db.cabinet.findUniqueOrThrow({
        where: { id: cabinetId },
        select: { profile: true },
      });
      const merged = {
        ...((current.profile as Record<string, unknown> | null) ?? {}),
        ...input.profile,
      };
      const checked = ProfileSchema.safeParse(merged);
      if (!checked.success) {
        const fields = Object.fromEntries(
          checked.error.issues.map((i) => [
            ['profile', ...i.path].join('.'),
            i.message,
          ]),
        );
        throw new ApiError('VALIDATION_FAILED', { fields });
      }
      data.profile = checked.data;
    }
    await this.db.cabinet.update({ where: { id: cabinetId }, data });
    return this.get(cabinetId);
  }
}
