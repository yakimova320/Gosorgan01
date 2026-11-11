import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { ExtractionModule } from '../extraction/extraction.module.js';
import { DialogueModule } from '../dialogue/dialogue.module.js';
import { DraftingModule } from '../drafting/drafting.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { CaseWorkflowService } from './case-workflow.service.js';
import { CasesController } from './cases.controller.js';
@Module({
  imports: [
    CasesModule,
    DocumentsModule,
    ExtractionModule,
    DialogueModule,
    DraftingModule,
    LlmModule,
  ],
  providers: [CaseWorkflowService],
  controllers: [CasesController],
})
export class WorkflowModule {}
