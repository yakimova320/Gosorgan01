import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ErasureModule } from '../erasure/erasure.module.js';
import { CabinetController } from './cabinet.controller.js';
import { CabinetService } from './cabinet.service.js';

@Module({
  imports: [AuthModule, ErasureModule],
  controllers: [CabinetController],
  providers: [CabinetService],
  exports: [CabinetService],
})
export class CabinetModule {}
