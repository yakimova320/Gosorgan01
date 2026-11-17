import { Module } from '@nestjs/common';
import { ClaimsService } from '../claims/claims.service.js';
import { DraftsController } from './drafts.controller.js';
import { DraftsService, VerificationService } from './drafts.service.js';

@Module({
  controllers: [DraftsController],
  providers: [ClaimsService, DraftsService, VerificationService],
})
export class DraftingModule {}
