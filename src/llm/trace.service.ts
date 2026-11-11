import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { CasesService } from '../cases/cases.service.js';
@Injectable()
export class TraceService {
  constructor(@Inject(CasesService) private readonly cases: CasesService) {}
  record(data: Prisma.LlmCallUncheckedCreateInput) {
    return this.cases.recordCall(data);
  }
  list(caseId: string) {
    return this.cases.trace(caseId);
  }
}
