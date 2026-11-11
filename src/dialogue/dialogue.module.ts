import { Module } from '@nestjs/common';
import { CasesModule } from '../cases/cases.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { DialogueService } from './dialogue.service.js';
import { RevisionService } from './revision.service.js';
@Module({
  imports: [CasesModule, LlmModule],
  providers: [DialogueService, RevisionService],
  exports: [DialogueService, RevisionService],
})
export class DialogueModule {}
