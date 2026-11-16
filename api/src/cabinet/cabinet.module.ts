import { Module } from '@nestjs/common';
import { CabinetController } from './cabinet.controller.js';
import { CabinetService } from './cabinet.service.js';

@Module({
  controllers: [CabinetController],
  providers: [CabinetService],
  exports: [CabinetService],
})
export class CabinetModule {}
