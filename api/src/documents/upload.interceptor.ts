import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import multer from 'multer';
import type { Observable } from 'rxjs';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';

const MB = 1024 * 1024;

/*
 * Приём multipart с пределами прямо при чтении запроса (multer): большой файл не читается в память целиком.
 * Ошибки загрузчика превращаются в коды API: FILE_TOO_LARGE, TOO_MANY_FILES, NO_FILE, VALIDATION_FAILED.
 */
@Injectable()
export class LetterUploadInterceptor implements NestInterceptor {
  private readonly upload: ReturnType<ReturnType<typeof multer>['array']>;
  private readonly maxFileMb: number;
  private readonly maxLetterMb: number;
  private readonly maxFiles: number;

  constructor(
    @Inject(APP_CONFIG)
    config: Pick<
      Env,
      'UPLOAD_MAX_FILE_MB' | 'UPLOAD_MAX_LETTER_MB' | 'UPLOAD_MAX_FILES'
    >,
  ) {
    // B11: один PDF или до UPLOAD_MAX_FILES фото на письмо; сочетание проверяет DocumentsService.
    this.maxFiles = config.UPLOAD_MAX_FILES;
    this.maxFileMb = config.UPLOAD_MAX_FILE_MB;
    this.maxLetterMb = config.UPLOAD_MAX_LETTER_MB;
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: config.UPLOAD_MAX_FILE_MB * MB,
        files: config.UPLOAD_MAX_FILES,
        fields: 5,
        fieldSize: 1024,
        parts: config.UPLOAD_MAX_FILES + 5,
        headerPairs: 100,
      },
    }).array('files', config.UPLOAD_MAX_FILES);
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (!req.is('multipart/form-data')) throw new ApiError('NO_FILE');

    await new Promise<void>((resolve, reject) => {
      this.upload(req, res, (err: unknown) =>
        err ? reject(this.toApiError(err)) : resolve(),
      );
    });

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw new ApiError('NO_FILE');
    if (files.some((f) => f.size === 0))
      throw new ApiError('FILE_DAMAGED', { reason: 'empty' }, 'Файл пустой');
    const total = files.reduce((sum, f) => sum + f.size, 0);
    if (total > this.maxLetterMb * MB)
      throw new ApiError('LETTER_TOO_LARGE', { maxMb: this.maxLetterMb });
    return next.handle();
  }

  private toApiError(err: unknown): unknown {
    if (!(err instanceof multer.MulterError)) return err;
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return new ApiError(
          'FILE_TOO_LARGE',
          { maxMb: this.maxFileMb },
          `Файл больше ${this.maxFileMb} МБ`,
        );
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_UNEXPECTED_FILE':
        return err.field && err.field !== 'files'
          ? new ApiError('NO_FILE', { field: err.field })
          : new ApiError(
              'TOO_MANY_FILES',
              { max: this.maxFiles },
              `Можно загрузить не больше ${this.maxFiles} фото на письмо`,
            );
      default:
        return new ApiError('VALIDATION_FAILED', { form: [err.message] });
    }
  }
}
