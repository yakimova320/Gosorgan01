import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFiles,
  UseGuards,
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
import { ThrottlerGuard } from '@nestjs/throttler';
import { IpLimit } from '../common/ip-limits.js';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  AssignLetterSchema,
  type AssignLetterInput,
  ConfirmClaimsSchema,
  CorrectClaimSchema,
  DeleteLetterQuerySchema,
  LetterFileQuerySchema,
  type LetterFileQuery,
  ListLettersQuerySchema,
  type ConfirmClaimsInput,
  type CorrectClaimInput,
  type InboxItem,
  type LetterDetail,
  RenameLetterSchema,
  type RenameLetterInput,
  type TranslationView,
  type UploadLetterResponse,
} from './letters.dto.js';
import { ExplainService, type ExplainResponse } from './explain.service.js';
import { LettersService } from './letters.service.js';
import { TranslateService } from './translate.service.js';
import { z } from 'zod';

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
    @Inject(ExplainService) private readonly explainer: ExplainService,
    @Inject(TranslateService) private readonly translator: TranslateService,
  ) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  @IpLimit('uploadLetter')
  @HttpCode(201)
  @UseInterceptors(LetterUploadInterceptor)
  @ApiOperation({
    summary:
      'Загрузить письмо: один PDF (с текстом или скан) или до 10 фото страниц (JPG, PNG)',
    description:
      'Тип определяется по содержимому. Лимиты проверяются при приёме и до вызова модели: ' +
      'файл до 10 МБ, все файлы до 20 МБ, до 10 фото, PDF до 20 страниц. Порядок полей files = порядок страниц. ' +
      'Фото и страницы скана распознаются одним обращением к модели (B11). Письмо попадает во входящие.'
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          maxItems: 10,
        },
      },
    },
  })
  @ApiCreatedResponse({ schema: { example: EXAMPLE } })
  @ApiResponse({
    status: 400,
    description:
      'NO_FILE (нет файла или пустое поле), TOO_MANY_FILES (больше 10 фото), MIXED_FILES (PDF вместе с другими файлами)',
    ...err('TOO_MANY_FILES', 'Можно загрузить не больше 10 фото на письмо', {
      max: 10,
    }),
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
      'UNREADABLE (фото или страница скана не читается: details.pages и код причины; письмо не сохраняется частично), FILE_DAMAGED, PDF_ENCRYPTED. При нескольких файлах в details.file номер файла',
    ...err(
      'UNREADABLE',
      'Страница 2 не читается. Фото размыто. Сделайте новое фото: телефон неподвижно, письмо целиком в кадре',
      { pages: [2], reason: 'BLURRY' },
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
    return this.letters.upload(
      auth.cabinetId,
      files.map((f) => f.buffer),
    );
  }

  @Get(':id/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'Оригинал письма (B11): фото страницы n или PDF целиком (n = 1)',
    description:
      'Только владельцу письма. Чужое письмо, неверный номер или удалённый файл: 404. Без имени файла и пути хранения.',
  })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiOkResponse({
    description: 'image/jpeg, image/png или application/pdf',
  })
  @ApiNotFoundResponse(NOT_FOUND)
  async file(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query(new ZodPipe(LetterFileQuerySchema)) query: LetterFileQuery,
  ): Promise<StreamableFile> {
    const { data, mime } = await this.letters.originalFile(
      auth.cabinetId,
      id,
      query.page,
    );
    const ext = mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg';
    return new StreamableFile(data, {
      type: mime,
      length: data.length,
      disposition: `inline; filename="letter-${query.page}.${ext}"`,
    });
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

  @Post(':id/assign')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Письмо в дело: существующее ({ caseId }) или новое ({ newCase: { title? } })',
    description:
      'Письмо, факты и сроки переносятся одной транзакцией. Повтор в то же дело ничего не меняет. ' +
      'Новое дело: ведомство и номер только из подтверждённых фактов, иначе название «Новое дело». ' +
      'Перенос из другого дела сбрасывает объяснение и помечает черновики старого дела устаревшими.',
  })
  @ApiBody({
    schema: {
      examples: {
        existing: { value: { caseId: 'cm0case1' } },
        fresh: { value: { newCase: {} } },
      },
    },
  })
  @ApiOkResponse({ schema: { example: { caseId: 'cm0case1', changed: true } } })
  @ApiNotFoundResponse(NOT_FOUND)
  @ApiConflictResponse(
    err('CASE_CLOSED', 'Дело завершено. Откройте его снова или создайте новое'),
  )
  assign(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(AssignLetterSchema)) body: AssignLetterInput,
  ): Promise<{ caseId: string; changed: boolean }> {
    return this.letters.assign(auth.cabinetId, id, body);
  }

  @Post(':id/explain')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Объяснение письма по-русски по его фактам',
    description:
      'Каждое утверждение ссылается на факты (claimIds); даты и числа проверяются по цитатам этих фактов. ' +
      'Сроки — все сроки письма с датой, confirmed: false у неподтверждённых. Кэш по версии фактов, языку и версии промпта. ' +
      'Факты изменились во время ответа: 409 CLAIMS_CHANGED. Даты не прошли проверку за 3 попытки: 422 DATES_NOT_VERIFIED.',
  })
  @ApiQuery({ name: 'lang', required: false, enum: ['ru'] })
  @ApiOkResponse({
    schema: {
      example: {
        lang: 'ru',
        about: {
          text: 'Jobcenter Musterstadt просит прислать выписки со счёта за сентябрь.',
          claimIds: ['cm0auth', 'cm0req'],
          unconfirmed: false,
        },
        actions: [
          {
            text: 'Прислать выписки со счёта до 30.11.2026.',
            claimIds: ['cm0req', 'cm0dl'],
            unconfirmed: false,
          },
        ],
        deadlines: [
          {
            date: '2026-11-30',
            claimId: 'cm0dl',
            kind: 'DOCUMENTS',
            confirmed: true,
          },
        ],
        unconfirmed: false,
        cached: false,
      },
    },
  })
  @ApiNotFoundResponse(NOT_FOUND)
  @ApiConflictResponse(
    err(
      'CLAIMS_CHANGED',
      'Факты письма изменились, пока готовилось объяснение. Запросите объяснение ещё раз',
    ),
  )
  @ApiUnprocessableEntityResponse(
    err(
      'DATES_NOT_VERIFIED',
      'Не удалось надёжно объяснить сроки. Посмотрите срок в оригинале письма',
    ),
  )
  explain(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query(
      new ZodPipe(z.object({ lang: z.enum(['ru']).default('ru') }).strict()),
    )
    query: { lang: 'ru' },
  ): Promise<ExplainResponse> {
    return this.explainer.explain(auth.cabinetId, id, query.lang);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Переименовать письмо',
    description:
      'Поправка 8: название при загрузке предлагает модель по цитате письма (extract.v3), человек может его изменить.',
  })
  @ApiBody({ schema: { example: { title: 'Jobcenter: выписки за сентябрь' } } })
  @ApiOkResponse({ description: 'Письмо с фактами и сроками, как GET /letters/:id' })
  @ApiNotFoundResponse(NOT_FOUND)
  rename(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(RenameLetterSchema)) body: RenameLetterInput,
  ): Promise<LetterDetail> {
    return this.letters.rename(auth.cabinetId, id, body);
  }

  @Post(':id/translate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Машинный перевод письма на русский',
    description:
      'Поправка 7: весь текст письма по-русски, перевод не официальный (machine: true). ' +
      'Кэш по тексту письма, языку и версии промпта; повтор из кэша модель не вызывает и лимит не тратит. ' +
      'Нужно согласие на анализ ИИ.',
  })
  @ApiQuery({ name: 'lang', required: false, enum: ['ru'] })
  @ApiOkResponse({
    schema: {
      example: {
        lang: 'ru',
        text: 'Jobcenter Musterstadt\n...\nПожалуйста, ответьте до 30.11.2026.',
        machine: true,
        cached: false,
      },
    },
  })
  @ApiNotFoundResponse(NOT_FOUND)
  translate(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Query(
      new ZodPipe(z.object({ lang: z.enum(['ru']).default('ru') }).strict()),
    )
    query: { lang: 'ru' },
  ): Promise<TranslationView> {
    return this.translator.translate(auth.cabinetId, id, query.lang);
  }
}
