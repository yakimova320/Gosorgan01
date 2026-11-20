import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Подтверждённый факт письма: единственный источник данных для черновика (AGENTS.md). */
export interface ConfirmedClaim {
  id: string;
  /** B16: у фактов своего письма (OUTGOING) письма нет */
  letterId: string | null;
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
  /** B16: строка для «Оснований» (поле формы по-русски); у фактов письма нет */
  label?: string;
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

  /**
   * B16: подтверждённые факты своего письма — поля формы, которые человек проверил и подтвердил
   * (basis USER, без письма). Только для дела OUTGOING этого кабинета, иначе 404.
   */
  async getConfirmedOutgoing(
    cabinetId: string,
    caseId: string,
  ): Promise<ConfirmedClaim[]> {
    const kase = await this.db.case.findFirst({
      where: { id: caseId, cabinetId, origin: 'OUTGOING' },
      select: { id: true },
    });
    if (!kase) throw new ApiError('NOT_FOUND');
    const rows = await this.db.claim.findMany({
      where: { caseId, letterId: null, basis: 'USER', status: 'CONFIRMED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        letterId: true,
        kind: true,
        value: true,
        quote: true,
        text: true,
      },
    });
    return rows.map(({ text, ...r }) => ({ ...r, label: text }));
  }
}
