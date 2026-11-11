import { Inject } from '@nestjs/common';
import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CasesService } from '../cases/cases.service.js';
import { LinkingService } from '../cases/linking.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import type { Upload } from '../documents/types.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import { DialogueService } from '../dialogue/dialogue.service.js';
import { RevisionService } from '../dialogue/revision.service.js';
import { DraftService } from '../drafting/draft.service.js';
import { VerificationService } from '../drafting/verification.service.js';
@Injectable()
export class CaseWorkflowService {
  constructor(
    @Inject(CasesService) private readonly cases: CasesService,
    @Inject(LinkingService) private readonly links: LinkingService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(ExtractionService) private readonly extraction: ExtractionService,
    @Inject(DialogueService) private readonly dialogue: DialogueService,
    @Inject(RevisionService) private readonly revision: RevisionService,
    @Inject(DraftService) private readonly drafting: DraftService,
    @Inject(VerificationService)
    private readonly verification: VerificationService,
  ) {}
  async ingestLetter(caseId: string, file: Upload) {
    await this.cases.require(caseId);
    const document = await this.documents.parse(file);
    if (!document.readable)
      throw new UnprocessableEntityException(document.reason);
    const extracted = await this.extraction.extract(
      document.text,
      caseId,
      document,
    );
    return this.cases.saveLetter(caseId, document, extracted);
  }
  async handleMessage(caseId: string, text: string) {
    await this.cases.require(caseId);
    const result = await this.dialogue.handle(caseId, text);
    // Commit user message and derived claims together, after the validated and traced LLM result.
    await this.cases.saveDialogue(
      caseId,
      text,
      result.claims,
      result.questions,
    );
    return {
      questions: result.questions,
      state: await this.cases.state(caseId),
    };
  }
  async confirmLink(caseId: string, linkId: string) {
    const target = await this.links.confirm(caseId, linkId);
    const state = await this.cases.state(target);
    await this.revision.revise(target, state.claims);
    return this.cases.state(target);
  }
  async confirmClaim(caseId: string, claimId: string) {
    const claim = await this.cases.confirmClaim(caseId, claimId);
    await this.revision.revise(caseId, [claim]);
    return this.cases.state(caseId);
  }
  async prepareDraft(caseId: string) {
    const claims = await this.cases.getConfirmedClaims(caseId);
    if (!claims.length)
      throw new ConflictException(
        'Нет подтверждённых утверждений. Проверьте цитаты документов и подтвердите сведения.',
      );
    const numbers = [
      ...new Set(
        claims.filter((c) => c.topic === 'caseNumber').map((c) => c.text),
      ),
    ];
    if (numbers.length > 1)
      throw new ConflictException(
        'В деле разные подтверждённые номера. Уточните связь документов.',
      );
    const generated = await this.drafting.generate(claims, { caseId });
    const report = this.verification.verify(generated, claims, {
      caseNumber: numbers[0],
    });
    if (!report.passed)
      throw new UnprocessableEntityException({
        code: 'DRAFT_VERIFICATION_FAILED',
        message: 'Черновик не прошёл проверку',
        details: report,
      });
    const draft = await this.cases.saveDraft(caseId, generated);
    return { draft, report };
  }
}
