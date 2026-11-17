import { Module } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service.js';
import { StorageService } from '../documents/storage.service.js';
import { LetterUploadInterceptor } from '../documents/upload.interceptor.js';
import { LettersController } from './letters.controller.js';
import { LettersService } from './letters.service.js';

@Module({
  controllers: [LettersController],
  providers: [
    LettersService,
    DocumentsService,
    StorageService,
    LetterUploadInterceptor,
  ],
  exports: [LettersService, StorageService],
})
export class LettersModule {}
