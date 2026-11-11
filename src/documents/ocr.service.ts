import { Inject } from '@nestjs/common';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
@Injectable()
export class OcrService {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}
  async recognize(images: Buffer[]) {
    const languagePath = this.config.getOrThrow<string>('OCR_LANG_PATH');
    const available = await Promise.allSettled([
      access(join(languagePath, 'deu.traineddata.gz')),
      access(join(languagePath, 'deu.traineddata')),
    ]);
    if (available.every((result) => result.status === 'rejected'))
      throw new ServiceUnavailableException(
        'Установите немецкие OCR-данные командой pnpm ocr:setup',
      );
    const worker = await createWorker('deu', 1, {
      langPath: languagePath,
      cachePath: languagePath,
      // Rejections propagate through awaited jobs; do not throw from the worker event callback.
      errorHandler: () => undefined,
      gzip: true,
    });
    try {
      await worker.setParameters({ user_defined_dpi: '300' });
      const pages = [];
      for (const image of images) {
        const prepared = await sharp(image, { limitInputPixels: 40000000 })
          .rotate()
          .grayscale()
          .normalise()
          .resize({ width: 2480, withoutEnlargement: false })
          .sharpen()
          .threshold(180)
          .png()
          .toBuffer();
        const { data } = await worker.recognize(prepared, { rotateAuto: true });
        pages.push({ text: data.text, confidence: data.confidence });
      }
      return { pages };
    } finally {
      await worker.terminate();
    }
  }
}
