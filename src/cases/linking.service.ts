import { Inject } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { CasesService } from './cases.service.js';
@Injectable()
export class LinkingService {
  constructor(@Inject(CasesService) private readonly cases: CasesService) {}
  confirm(caseId: string, linkId: string) {
    return this.cases.confirmLink(caseId, linkId);
  }
}
