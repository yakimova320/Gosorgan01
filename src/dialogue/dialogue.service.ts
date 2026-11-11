import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { LlmService } from '../llm/llm.service.js';
import { CasesService } from '../cases/cases.service.js';
export const DialogueSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().min(1).max(5000),
        topic: z.string().min(1).max(100),
      }),
    )
    .max(20),
  questions: z.array(z.string().min(1).max(1000)).max(3),
});
@Injectable()
export class DialogueService {
  constructor(
    @Inject(LlmService) private readonly llm: LlmService,
    @Inject(CasesService) private readonly cases: CasesService,
  ) {}
  async handle(caseId: string, message: string) {
    const state = await this.cases.state(caseId);
    if (
      /Widerspruch|Klage|Aufenthaltsrecht|Rechtsberatung|обжалова|адвокат|право на проживание/i.test(
        message,
      )
    )
      return {
        claims: [{ text: message, topic: 'legalQuestion' }],
        questions: [
          'Для юридической оценки обратитесь в консультационную службу или к адвокату.',
        ],
      };
    return this.llm.call({
      promptName: 'dialogue',
      caseId,
      variables: { message, openQuestions: state.openQuestions },
      schema: DialogueSchema,
    });
  }
}
