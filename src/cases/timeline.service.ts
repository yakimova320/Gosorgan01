import { Injectable } from '@nestjs/common';
import type { Claim, Deadline, Event, Letter } from '@prisma/client';
@Injectable()
export class TimelineService {
  build(
    events: Event[],
    deadlines: (Deadline & { claim: Claim })[],
    claims: Claim[],
    letters: Letter[],
    now = new Date(),
  ) {
    const today = now.toISOString().slice(0, 10);
    const nearestDeadline =
      deadlines
        .filter(
          (d) =>
            d.claim.status === 'CONFIRMED' &&
            d.date.toISOString().slice(0, 10) >= today,
        )
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0] ?? null;
    const openQuestions = claims
      .filter((c) => c.status === 'UNCONFIRMED')
      .map((c) => ({
        claimId: c.id,
        question: `Подтвердите утверждение и его источник: ${c.text}`,
      }));
    for (const letter of letters) {
      if (!letter.caseNumber)
        openQuestions.push({
          claimId: letter.id,
          question: 'Какой номер дела указан в письме?',
        });
      if (!letter.authority)
        openQuestions.push({
          claimId: letter.id,
          question: 'Какое ведомство отправило письмо?',
        });
      if (!(letter.extraction as { deadlines?: unknown[] }).deadlines?.length)
        openQuestions.push({
          claimId: letter.id,
          question:
            'Срок ответа не найден. Уточните его в письме или у ведомства.',
        });
      if (!letter.letterDate)
        openQuestions.push({
          claimId: letter.id,
          question: 'Какая дата указана в письме?',
        });
    }
    return {
      timeline: [...events].sort((a, b) => a.at.getTime() - b.at.getTime()),
      nearestDeadline,
      openQuestions,
    };
  }
}
