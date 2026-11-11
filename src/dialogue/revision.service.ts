import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { CasesService } from '../cases/cases.service.js';
import type { Claim } from '@prisma/client';
@Injectable()
export class RevisionService {
  constructor(@Inject(CasesService) private readonly cases: CasesService) {}
  async revise(caseId: string, newClaims: Claim[]) {
    const state = await this.cases.state(caseId);
    const replacements: { oldId: string; newId: string; reason: string }[] = [];
    // Conservative MVP rule: a reviewed receipt for the same named document replaces a user's unsupported delivery statement.
    // A repeated request alone never proves that the user did not send something.
    const nouns = ['Kontoauszüge', 'Mietvertrag', 'Einkommensnachweise'];
    const aliases: Record<string, string[]> = {
      Kontoauszuege: ['kontoauszug', 'выписка'],
      Mietvertrag: ['mietvertrag', 'договор аренды'],
      Einkommensnachweise: ['einkommensnachweis', 'справка', 'доход'],
    };
    for (const current of newClaims.filter(
      (c) => c.basis === 'DOCUMENT' && c.status === 'CONFIRMED',
    )) {
      if (
        !/^Wir bestätigen den (?:Eingang|Erhalt) Ihrer (?:Kontoauszüge|Mietvertrag|Einkommensnachweise)(?: am \d{2}\.\d{2}\.\d{4})?\.$/i.test(
          (current.quote ?? '').trim(),
        )
      )
        continue;
      for (const previous of state.claims.filter(
        (c) => c.basis === 'USER' && c.status === 'UNCONFIRMED',
      )) {
        const common = nouns.some(
          (noun) =>
            (current.quote ?? '').toLowerCase().includes(noun.toLowerCase()) &&
            aliases[noun].some((a) => previous.text.toLowerCase().includes(a)),
        );
        if (
          common &&
          /отправ|посла|gesendet|geschickt|eingereicht/i.test(previous.text)
        )
          replacements.push({
            oldId: previous.id,
            newId: current.id,
            reason:
              'Ранее была только информация со слов пользователя. Теперь проверенное письмо ведомства подтверждает получение указанного документа. Это не доказывает дату отправки.',
          });
      }
    }
    await this.cases.supersedeClaims(caseId, replacements);
    return replacements;
  }
}
