import { Module } from '@nestjs/common';
import { LettersModule } from '../letters/letters.module.js';
import { AccountErasureService } from './account-erasure.service.js';

@Module({
  imports: [LettersModule],
  providers: [AccountErasureService],
  exports: [AccountErasureService],
})
export class ErasureModule {}
