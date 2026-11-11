import { Module } from '@nestjs/common';
import { CasesService } from './cases.service.js';
import { LinkingService } from './linking.service.js';
import { TimelineService } from './timeline.service.js';
import { PrismaService } from './prisma.service.js';
@Module({
  providers: [CasesService, LinkingService, TimelineService, PrismaService],
  exports: [CasesService, LinkingService],
})
export class CasesModule {}
