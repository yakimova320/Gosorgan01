import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { ExtractionService } from './extraction.service.js';
@Module({
  imports: [LlmModule],
  providers: [ExtractionService],
  exports: [ExtractionService],
})
export class ExtractionModule {}
