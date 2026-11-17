import {
  Controller,
  HttpCode,
  Inject,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/session.guard.js';
import { LetterUploadInterceptor } from '../documents/upload.interceptor.js';
import type { UploadLetterResponse } from './letters.dto.js';
import { LettersService } from './letters.service.js';

const err = (code: string, message: string, details?: unknown) => ({
  schema: { example: { code, message, ...(details ? { details } : {}) } },
});

const EXAMPLE: UploadLetterResponse = {
  letter: {
    id: '7f1c2e9a-3b4d-4c5e-8f60-1a2b3c4d5e6f',
    caseId: null,
    sourceType: 'PDF_TEXT',
    text: 'Jobcenter Musterstadt\n…\nBitte reichen Sie bis zum 30.11.2026 Kontoauszüge ein.',
    pages: [{ n: 1, readable: true, chars: 593 }],
    files: [{ n: 1, mime: 'application/pdf', bytes: 2210 }],
    createdAt: '2026-11-17T10:00:00.000Z',
  },
  claims: [],
  deadlines: [],
  suggestions: [],
};

@ApiTags('Письма')
@ApiBearerAuth()
@Controller('letters')
export class LettersController {
  constructor(
    @Inject(LettersService) private readonly letters: LettersService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(LetterUploadInterceptor)
  @ApiOperation({
    summary: 'Загрузить письмо: один PDF с текстом или одно фото (JPG, PNG)',
    description:
      'Тип определяется по содержимому. Лимиты проверяются при приёме и до вызова модели. ' +
      'Письмо попадает во входящие. Факты (claims) добавляет B06.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: { files: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ schema: { example: EXAMPLE } })
  @ApiResponse({
    status: 400,
    description:
      'NO_FILE (нет файла или пустое поле), TOO_MANY_FILES (пока один файл)',
    ...err(
      'TOO_MANY_FILES',
      'Пока можно загрузить одно фото или один PDF на письмо',
      { max: 1 },
    ),
  })
  @ApiUnauthorizedResponse(err('UNAUTHORIZED', 'Войдите, чтобы продолжить'))
  @ApiPayloadTooLargeResponse({
    description:
      'FILE_TOO_LARGE (файл или пиксели фото), LETTER_TOO_LARGE (больше 20 страниц или слишком много текста)',
    ...err('LETTER_TOO_LARGE', 'В PDF 21 страниц. Можно не больше 20', {
      pages: 21,
      maxPages: 20,
    }),
  })
  @ApiResponse({
    status: 415,
    ...err(
      'UNSUPPORTED_TYPE',
      'Этот формат не подходит. Загрузите PDF, JPG или PNG',
    ),
  })
  @ApiUnprocessableEntityResponse({
    description:
      'UNREADABLE (фото не читается, details.pages и код причины), SCAN_PDF_NOT_SUPPORTED (страницы без текста в details.pages), FILE_DAMAGED, PDF_ENCRYPTED',
    ...err(
      'SCAN_PDF_NOT_SUPPORTED',
      'В этом PDF нет текста, это скан. Сфотографируйте письмо и загрузите фото',
      {
        pages: [1],
        totalPages: 1,
      },
    ),
  })
  @ApiResponse({
    status: 502,
    ...err('LLM_FAILED', 'Не получилось разобрать письмо. Попробуйте ещё раз'),
  })
  @ApiResponse({
    status: 503,
    ...err('LLM_QUOTA', 'Ja!sno сейчас перегружен. Попробуйте позже'),
  })
  upload(
    @CurrentAuth() auth: AuthContext,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<UploadLetterResponse> {
    return this.letters.upload(auth.cabinetId, files[0].buffer);
  }
}
