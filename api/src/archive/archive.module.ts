import { Module } from '@nestjs/common';
import { ArchiveController } from './archive.controller.js';
import { ArchiveRepository } from './archive.repository.js';
import { ArchiveService } from './archive.service.js';

/** L05 (#81): вопросы к архиву писем (RAG, pgvector). */
@Module({
  controllers: [ArchiveController],
  providers: [ArchiveRepository, ArchiveService],
})
export class ArchiveModule {}
