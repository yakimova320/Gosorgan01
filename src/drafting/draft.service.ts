import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { ConfirmedClaim } from '../cases/types.js';
import { LlmService } from '../llm/llm.service.js';
import { DraftSchema } from './draft.schema.js';
import { draftTemplate } from './templates.js';
@Injectable()
export class DraftService {
  constructor(@Inject(LlmService) private readonly llm: LlmService) {}
  generate(claims: ConfirmedClaim[], context: { caseId: string }) {
    const template = draftTemplate(claims);
    return this.llm.call({
      promptName: 'draft',
      caseId: context.caseId,
      variables: {
        claims,
        claimIds: template.usedClaimIds,
        expectedGermanText: template.germanText,
        expectedRussianExplanation: template.russianExplanation,
      },
      schema: DraftSchema,
    });
  }
}
