import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service.js';
import { OcrService } from './ocr.service.js';
@Module({
  providers: [DocumentsService, OcrService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
