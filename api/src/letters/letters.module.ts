import { Module } from '@nestjs/common';
import { ArchiveModule } from '../archive/archive.module.js';
import { DocumentsService } from '../documents/documents.service.js';
import { StorageService } from '../documents/storage.service.js';
import { LetterUploadInterceptor } from '../documents/upload.interceptor.js';
import { ExplainService } from './explain.service.js';
import { LettersController } from './letters.controller.js';
import { LettersService } from './letters.service.js';
import { TranslateService } from './translate.service.js';

@Module({
  imports: [ArchiveModule],
  controllers: [LettersController],
  providers: [
    ExplainService,
    TranslateService,
    LettersService,
    DocumentsService,
    StorageService,
    LetterUploadInterceptor,
  ],
  exports: [LettersService, StorageService],
})
export class LettersModule {}
