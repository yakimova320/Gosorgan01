import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiQuery,
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
import { ZodPipe } from '../common/zod.pipe.js';
import {
  ConfirmClaimsSchema,
  CorrectClaimSchema,
  DeleteLetterQuerySchema,
  ListLettersQuerySchema,
  type ConfirmClaimsInput,
  type CorrectClaimInput,
  type InboxItem,
  type LetterDetail,
  type UploadLetterResponse,
} from './letters.dto.js';
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
  claims: [
    {
      id: 'cm0claim1',
      kind: 'DEADLINE',
      value: '2026-11-30',
      text: 'Срок: до 30.11.2026 (прислать документы)',
      quote: 'Bitte reichen Sie bis zum 30.11.2026 Kontoauszüge ein.',
      page: 1,
      basis: 'DOCUMENT',
      status: 'UNCONFIRMED',
      supersedesId: null,
      relativeDeadline: false,
    },
  ],
  deadlines: [
    {
      id: 'cm0dl1',
      claimId: 'cm0claim1',
      date: '2026-11-30',
      kind: 'DOCUMENTS',
      active: false,
      done: false,
    },
  ],
  suggestions: [],
  extraction: { dropped: 0 },
};
const NOT_FOUND = err('NOT_FOUND', 'Не найдено');

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

  @Get()
  @ApiOperation({
    summary: 'Письма кабинета; inbox=true: только входящие (без дела)',
  })
  @ApiQuery({ name: 'inbox', required: false, enum: ['true', 'false'] })
  @ApiOkResponse({
    schema: {
      example: [
        {
          id: EXAMPLE.letter.id,
          createdAt: EXAMPLE.letter.createdAt,
          sourceType: 'PDF_TEXT',
          authority: 'Jobcenter Musterstadt',
          caseNumber: 'JC-2026-1001',
          unconfirmed: 4,
        },
      ],
    },
  })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(ListLettersQuerySchema))
    query: { inbox?: 'true' | 'false' },
  ): Promise<InboxItem[]> {
    return this.letters.list(auth.cabinetId, query.inbox === 'true');
  }

  @Get(':id')
  @ApiOperation({ summary: 'Письмо, действующие факты с цитатами и сроки' })
  @ApiOkResponse({
    schema: {
      example: {
        letter: EXAMPLE.letter,
        claims: EXAMPLE.claims,
        deadlines: EXAMPLE.deadlines,
      },
    },
  })
  @ApiNotFoundResponse(NOT_FOUND)
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<LetterDetail> {
    return this.letters.detail(auth.cabinetId, id);
  }

  @Post(':id/claims/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Верно / Неверно: подтвердить и отклонить факты одной транзакцией',
    description:
      'Повтор того же решения ничего не меняет. Противоположное решение или заменённый факт: 409 CLAIM_STATE. ' +
      'Сбрасывает объяснение письма, черновики с этими фактами помечаются устаревшими.',
  })
  @ApiBody({
    schema: { example: { confirm: ['cm0claim1'], reject: ['cm0claim2'] } },
  })
  @ApiOkResponse({
    schema: {
      example: {
        letter: EXAMPLE.letter,
        claims: EXAMPLE.claims,
        deadlines: EXAMPLE.deadlines,
      },
    },
  })
  @ApiNotFoundResponse(NOT_FOUND)
  @ApiConflictResponse(
    err('CLAIM_STATE', 'Этот факт уже изменён. Обновите страницу', {
      claimId: 'cm0claim1',
      status: 'REJECTED',
    }),
  )
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(ConfirmClaimsSchema)) body: ConfirmClaimsInput,
  ): Promise<LetterDetail> {
    return this.letters.confirm(auth.cabinetId, id, body);
  }

  @Post(':id/claims/:claimId/correct')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Исправить факт: новая запись USER/UNCONFIRMED, старая SUPERSEDED',
    description:
      'Даты: YYYY-MM-DD. У исправленного факта нет цитаты. Объяснение сбрасывается.',
  })
  @ApiBody({ schema: { example: { value: '2026-12-05' } } })
  @ApiOkResponse({
    schema: {
      example: {
        letter: EXAMPLE.letter,
        claims: EXAMPLE.claims,
        deadlines: EXAMPLE.deadlines,
      },
    },
  })
  @ApiNotFoundResponse(NOT_FOUND)
  @ApiConflictResponse(
    err('CLAIM_STATE', 'Этот факт уже изменён. Обновите страницу'),
  )
  correct(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Param('claimId') claimId: string,
    @Body(new ZodPipe(CorrectClaimSchema)) body: CorrectClaimInput,
  ): Promise<LetterDetail> {
    return this.letters.correct(auth.cabinetId, id, claimId, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Удалить письмо или оставить во входящих',
    description:
      'Без mode: письмо, факты, сроки, файл и журнал удаляются. mode=inbox: письмо остаётся во входящих. ' +
      'Другие значения mode: 400, ничего не удаляется.',
  })
  @ApiQuery({ name: 'mode', required: false, enum: ['inbox'] })
  @ApiNoContentResponse({ description: 'Готово' })
  @ApiNotFoundResponse(NOT_FOUND)
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query(new ZodPipe(DeleteLetterQuerySchema)) query: { mode?: 'inbox' },
  ): Promise<void> {
    await this.letters.remove(auth.cabinetId, id, query.mode);
  }
}
