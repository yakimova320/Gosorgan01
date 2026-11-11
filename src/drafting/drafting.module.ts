import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { DraftService } from './draft.service.js';
import { VerificationService } from './verification.service.js';
@Module({
  imports: [LlmModule],
  providers: [DraftService, VerificationService],
  exports: [DraftService, VerificationService],
})
export class DraftingModule {}
