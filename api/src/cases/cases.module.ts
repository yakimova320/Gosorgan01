import { Module } from '@nestjs/common';
import { LettersModule } from '../letters/letters.module.js';
import { CasesController } from './cases.controller.js';
import { CasesService } from './cases.service.js';

@Module({
  imports: [LettersModule],
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}
