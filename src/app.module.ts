import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { WorkflowModule } from './workflow/workflow.module.js';
@Module({ imports: [ConfigModule, WorkflowModule] })
export class AppModule {}
