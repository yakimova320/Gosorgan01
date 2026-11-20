import { Module } from '@nestjs/common';
import { DeadlinesController } from './deadlines.controller.js';
import { DeadlinesService } from './deadlines.service.js';

@Module({
  controllers: [DeadlinesController],
  providers: [DeadlinesService],
})
export class DeadlinesModule {}
