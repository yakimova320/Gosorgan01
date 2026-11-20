import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/session.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  CreateDraftSchema,
  type CreateDraftInput,
  type DraftQuestions,
  type DraftView,
} from './drafts.dto.js';
import { DraftsService } from './drafts.service.js';

const err = (code: string, message: string, details?: unknown) => ({
  schema: { example: { code, message, ...(details ? { details } : {}) } },
});

@ApiTags('Черновики')
@ApiBearerAuth()
@Controller()
export class DraftsController {
  constructor(@Inject(DraftsService) private readonly drafts: DraftsService) {}

  @Post('cases/:id/draft')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Черновик «запрос уточнения» по шаблону из подтверждённых фактов одного письма дела',
    description:
      'questionId — готовый вопрос (WHICH_DOCUMENTS, DEADLINE, REASON, FORMAT, AMOUNT); доступность проверяет сервер. ' +
      'Проверка текста (DE и RU): шаблон и источники, не юридическая проверка. kind WIDERSPRUCH: 422 LEGAL_REFERRAL.',
  })
  @ApiBody({
    schema: {
      example: {
        kind: 'CLARIFICATION',
        letterId: 'cm0letter1',
        questionId: 'WHICH_DOCUMENTS',
      },
    },
  })
  @ApiNotFoundResponse(err('NOT_FOUND', 'Не найдено'))
  @ApiConflictResponse(
    err('NO_CONFIRMED_CLAIMS', 'Сначала подтвердите факты письма'),
  )
  @ApiUnprocessableEntityResponse(
    err('LEGAL_REFERRAL', 'С этим лучше обратиться в консультацию', {
      places: ['Verbraucherzentrale'],
    }),
  )
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(CreateDraftSchema)) body: CreateDraftInput,
  ): Promise<DraftView> {
    return this.drafts.create(auth.cabinetId, id, body);
  }

  @Get('drafts/:id')
  @ApiOperation({ summary: 'Черновик: тексты DE и RU, отчёт проверки, stale' })
  @ApiOkResponse({ description: 'Черновик' })
  @ApiNotFoundResponse(err('NOT_FOUND', 'Не найдено'))
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<DraftView> {
    return this.drafts.get(auth.cabinetId, id);
  }

  @Get('drafts/:id/pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({
    summary: 'PDF письма для печати (B15): немецкий текст черновика, A4, место для подписи',
    description:
      'Только владельцу. Устаревший черновик: 409 DRAFT_STALE. Знаки вне стандартного шрифта (например, кириллица в адресе): ' +
      '422 PDF_UNSUPPORTED_CHARS со списком знаков. В метаданных PDF нет личных данных.',
  })
  @ApiOkResponse({ description: 'application/pdf' })
  @ApiNotFoundResponse(err('NOT_FOUND', 'Не найдено'))
  @ApiConflictResponse(
    err('DRAFT_STALE', 'Данные изменились после сборки черновика. Соберите черновик заново'),
  )
  @ApiUnprocessableEntityResponse(
    err('PDF_UNSUPPORTED_CHARS', 'В тексте есть знаки, которые нельзя напечатать в PDF: д р', {
      chars: ['д', 'р'],
    }),
  )
  async pdf(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const data = await this.drafts.pdf(auth.cabinetId, id);
    return new StreamableFile(data, {
      type: 'application/pdf',
      length: data.length,
      disposition: 'inline; filename="brief.pdf"',
    });
  }

  @Get('letters/:id/draft-questions')
  @ApiOperation({
    summary:
      'Доступные готовые вопросы для письма в деле и его подтверждённые суммы',
  })
  @ApiNotFoundResponse(err('NOT_FOUND', 'Не найдено'))
  questions(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<DraftQuestions> {
    return this.drafts.questions(auth.cabinetId, id);
  }
}
