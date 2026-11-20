import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
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
import {
  OutgoingSchema,
  type OutgoingInput,
  type OutgoingTemplate,
} from '@jasno/shared';
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
  type OutgoingResult,
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
      '(запрос о ходе рассмотрения), TEMPLATE (B16: собрать заново своё письмо дела OUTGOING, без других полей). Доступность проверяет сервер (GET /letters/:id/draft-questions → kinds). ' +
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

  @Get('templates')
  @ApiOperation({
    summary: 'Шаблоны своих писем (B16): шесть шаблонов и их поля',
    description:
      'Поля: key, type (text — по-немецки латиницей, reference — номер дела или клиента, date — ГГГГ-ММ-ДД, ' +
      'iban, select — один из options), labelRu, hintRu, required. Немецкие формулировки собирает сервер.',
  })
  @ApiOkResponse({ description: 'Каталог шаблонов' })
  templates(): OutgoingTemplate[] {
    return this.drafts.templates();
  }

  @Post('outgoing')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Своё письмо по шаблону (B16): дело OUTGOING и проверенный черновик',
    description:
      'Поля формы человек проверил и подтвердил на экране проверки: они сохраняются как подтверждённые факты дела ' +
      '(basis USER) и становятся единственным источником черновика. Без модели. Ошибки полей: 400 VALIDATION_FAILED ' +
      'с путями fields.<key> и recipient.<name|address>; даты относительно сегодняшнего дня проверяет сервер. ' +
      'Дальше как у ответа: GET/PATCH /drafts/:id, PDF, «Я отправил(а)»; «Собрать заново» — POST /cases/:id/draft { kind: TEMPLATE }.',
  })
  @ApiBody({
    schema: {
      example: {
        templateId: 'NEUES_KONTO',
        recipient: {
          name: 'Jobcenter Berlin Mitte',
          address: 'Musterstraße 1\n10115 Berlin',
        },
        fields: { reference: '123A456789', iban: 'DE89370400440532013000' },
      },
    },
  })
  @ApiUnprocessableEntityResponse(
    err('DRAFT_VERIFICATION_FAILED', 'Черновик не прошёл проверку'),
  )
  createOutgoing(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(OutgoingSchema)) body: OutgoingInput,
  ): Promise<OutgoingResult> {
    return this.drafts.createOutgoing(auth.cabinetId, body);
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
