import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
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
  EditDraftSchema,
  ReportSentSchema,
  type CreateDraftInput,
  type DraftQuestions,
  type DraftView,
  type EditDraftInput,
  type ReportSentInput,
  type ReportSentResult,
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
      'Черновик ответа по шаблону из подтверждённых фактов одного письма дела',
    description:
      'kind: CLARIFICATION (questionId — готовый вопрос: WHICH_DOCUMENTS, DEADLINE, REASON, FORMAT, AMOUNT), ' +
      'DOCUMENTS (сопроводительное письмо, нужно подтверждённое требование), EXTENSION (просьба продлить срок: ' +
      'deadlineClaimId — подтверждённый не прошедший срок, reason — DOCUMENTS_PENDING, ADVICE, NONE), STATUS_REQUEST ' +
      '(запрос о ходе рассмотрения). Доступность проверяет сервер (GET /letters/:id/draft-questions → kinds). ' +
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

  @Patch('drafts/:id')
  @ApiOperation({
    summary: 'Правка черновика (B12) с повторной проверкой обоих текстов',
    description:
      'Проверка по тем же источникам, что при сборке. Не прошла: 422 DRAFT_VERIFICATION_FAILED с отчётом, ничего не сохраняется. ' +
      'Устаревший черновик: 409 DRAFT_STALE; отправленный: 409 DRAFT_ALREADY_SENT. После правки edited: true.',
  })
  @ApiBody({
    schema: {
      example: {
        germanText: 'Anna Muster\nMusterstr. 12, 10115 Berlin\n…',
        russianText: 'Anna Muster\nMusterstr. 12, 10115 Berlin\n…',
      },
    },
  })
  @ApiNotFoundResponse(err('NOT_FOUND', 'Не найдено'))
  @ApiConflictResponse(
    err('DRAFT_STALE', 'Данные изменились после сборки черновика. Соберите черновик заново'),
  )
  @ApiUnprocessableEntityResponse(
    err('DRAFT_VERIFICATION_FAILED', 'Черновик не прошёл проверку', {
      passed: false,
      checks: [
        { name: 'de: даты из источников', passed: false, details: 'не из источников: 2026-12-24' },
      ],
    }),
  )
  edit(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(EditDraftSchema)) body: EditDraftInput,
  ): Promise<DraftView> {
    return this.drafts.edit(auth.cabinetId, id, body);
  }

  @Post('cases/:id/sent')
  @HttpCode(201)
  @ApiOperation({
    summary: '«Я отправил(а)» (B12): канал, дата, черновик; закрыть выбранный срок',
    description:
      'Сообщение пользователя, не подтверждение доставки. via: post, online, email, in_person, other. ' +
      'date не в будущем (Europe/Berlin). closeDeadlineId — только подтверждённый срок этого дела. ' +
      'Повтор для того же черновика: 409 DRAFT_ALREADY_SENT; срок уже закрыт: 409 DEADLINE_ALREADY_DONE.',
  })
  @ApiBody({
    schema: {
      example: {
        draftId: 'cm0draft1',
        via: 'post',
        date: '2026-11-20',
        closeDeadlineId: 'cm0dl1',
      },
    },
  })
  @ApiNotFoundResponse(err('NOT_FOUND', 'Не найдено'))
  @ApiConflictResponse(
    err('DRAFT_ALREADY_SENT', 'Этот черновик уже отмечен как отправленный'),
  )
  reportSent(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(ReportSentSchema)) body: ReportSentInput,
  ): Promise<ReportSentResult> {
    return this.drafts.reportSent(auth.cabinetId, id, body);
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
