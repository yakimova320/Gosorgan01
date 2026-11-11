import { Inject } from '@nestjs/common';
import {
  Injectable,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { OcrService } from './ocr.service.js';
import type { ParsedDocument, Upload } from './types.js';
const execute = promisify(execFile);
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(OcrService) private readonly ocr: OcrService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}
  async parse(file: Upload): Promise<ParsedDocument> {
    if (!file?.buffer?.length || file.buffer.length > 10 * 1024 * 1024)
      throw new UnprocessableEntityException('Файл пуст или больше 10 МБ');
    const pdf = file.buffer.subarray(0, 5).toString() === '%PDF-';
    const png = file.buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpg =
      file.buffer[0] === 255 &&
      file.buffer[1] === 216 &&
      file.buffer[2] === 255;
    if (
      !(pdf && file.mimetype === 'application/pdf') &&
      !(png && file.mimetype === 'image/png') &&
      !(jpg && file.mimetype === 'image/jpeg')
    )
      throw new UnprocessableEntityException(
        'Поддерживаются только PDF, JPG и PNG с корректным содержимым',
      );
    try {
      return await this.parseValidated(file, pdf);
    } catch (error) {
      if (
        error instanceof UnprocessableEntityException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new UnprocessableEntityException(
        'Не удалось прочитать файл: повреждённый, зашифрованный или неподдерживаемый документ',
      );
    }
  }
  private async parseValidated(
    file: Upload,
    pdf: boolean,
  ): Promise<ParsedDocument> {
    let images = [file.buffer];
    if (pdf) {
      const parser = new PDFParse({ data: new Uint8Array(file.buffer) });
      try {
        const info = await parser.getInfo();
        if (info.total > 20)
          throw new UnprocessableEntityException(
            'PDF содержит больше 20 страниц',
          );
        const result = await parser.getText({ pageJoiner: '' });
        const pages = result.pages.map((p) => ({
          text: p.text,
          confidence: 100,
        }));
        const text = pages.map((p) => p.text).join('\n');
        if (
          text.trim().length >= this.config.getOrThrow<number>('OCR_MIN_TEXT')
        )
          return {
            text,
            pages,
            source: 'TEXT_LAYER',
            sourceType: 'PDF_TEXT',
            readable: true,
          };
      } finally {
        await parser.destroy();
      }
      images = await this.rasterize(file.buffer);
    }
    const result = await this.ocr.recognize(images);
    const text = result.pages.map((p) => p.text).join('\n');
    const confidence =
      result.pages.reduce((sum, p) => sum + p.confidence, 0) /
      Math.max(result.pages.length, 1);
    const readable =
      text.trim().length >= this.config.getOrThrow<number>('OCR_MIN_TEXT') &&
      confidence >= this.config.getOrThrow<number>('OCR_MIN_CONFIDENCE');
    return {
      text,
      pages: result.pages,
      source: 'OCR',
      sourceType: pdf ? 'PDF_SCAN' : 'IMAGE',
      readable,
      ocrConfidence: confidence,
      ...(!readable
        ? {
            reason:
              'Плохое качество изображения, загрузите более чёткий снимок или скан',
          }
        : {}),
    };
  }
  private async rasterize(buffer: Buffer) {
    const dir = await mkdtemp(join(tmpdir(), 'razberemsya-'));
    try {
      const input = join(dir, 'input.pdf');
      await writeFile(input, buffer);
      try {
        await execute(
          this.config.getOrThrow<string>('PDFTOPPM_PATH'),
          ['-r', '200', '-scale-to', '3000', '-png', input, join(dir, 'page')],
          { timeout: 90000, maxBuffer: 1024 * 1024 },
        );
      } catch {
        throw new ServiceUnavailableException(
          'Для OCR PDF установите Poppler (pdftoppm)',
        );
      }
      const files = (await readdir(dir))
        .filter((f) => /^page-.*\.png$/.test(f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return await Promise.all(files.map((f) => readFile(join(dir, f))));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
