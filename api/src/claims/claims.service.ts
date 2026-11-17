import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Подтверждённый факт письма: единственный источник данных для черновика (AGENTS.md). */
export interface ConfirmedClaim {
  id: string;
  letterId: string;
  kind:
    | 'AUTHORITY'
    | 'CASE_NUMBER'
    | 'LETTER_DATE'
    | 'REQUIREMENT'
    | 'DEADLINE'
    | 'AMOUNT'
    | 'OTHER';
  value: string;
  quote: string | null;
}

@Injectable()
export class ClaimsService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  /**
   * Подтверждённые факты одного письма дела. Проверяет, что дело принадлежит кабинету,
   * а письмо — этому делу: факты разных писем не смешиваются. Иначе 404.
   */
  async getConfirmed(
    cabinetId: string,
    caseId: string,
    letterId: string,
  ): Promise<ConfirmedClaim[]> {
    const letter = await this.db.letter.findFirst({
      where: { id: letterId, caseId, cabinetId, case: { cabinetId } },
      select: { id: true },
    });
    if (!letter) throw new ApiError('NOT_FOUND');
    const rows = await this.db.claim.findMany({
      where: { letterId, status: 'CONFIRMED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        letterId: true,
        kind: true,
        value: true,
        quote: true,
      },
    });
    return rows.map((r) => ({ ...r, letterId: r.letterId! }));
  }
}
