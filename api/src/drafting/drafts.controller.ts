import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
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
