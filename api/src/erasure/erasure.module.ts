import { Module } from '@nestjs/common';
import { LettersModule } from '../letters/letters.module.js';
import { AccountErasureService } from './account-erasure.service.js';
import { RetentionService } from './retention.service.js';

@Module({
  imports: [LettersModule],
  providers: [AccountErasureService, RetentionService],
  exports: [AccountErasureService, RetentionService],
})
export class ErasureModule {}
