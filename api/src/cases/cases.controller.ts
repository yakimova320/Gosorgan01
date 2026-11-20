import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/session.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  HistoryQuerySchema,
  ListCasesQuerySchema,
  UpdateCaseSchema,
  type CaseDetail,
  type CaseSummary,
  type HistoryItem,
  type HistoryQuery,
  type ListCasesQuery,
  type TraceItem,
  type UpdateCaseInput,
} from './cases.dto.js';
import { CasesService } from './cases.service.js';

const NOT_FOUND = {
  schema: { example: { code: 'NOT_FOUND', message: 'Не найдено' } },
};
const SUMMARY: CaseSummary = {
  id: 'cm0case1',
  title: 'Jobcenter Musterstadt: Bitte reichen Sie die Kontoauszüge ein.',
  authority: 'Jobcenter Musterstadt',
  caseNumber: 'JC-2026-1001',
  origin: 'INCOMING',
  status: 'OPEN',
  stage: 'DOCUMENTS',
  nextDeadline: '2026-11-30',
  counts: { letters: 1, unconfirmed: 2 },
  updatedAt: '2026-11-17T10:00:00.000Z',
};

@ApiTags('Дела')
@ApiBearerAuth()
@Controller()
export class CasesController {
  constructor(@Inject(CasesService) private readonly cases: CasesService) {}

  @Get('cases')
  @ApiOperation({
    summary: 'Дела кабинета со статусом (stage) и ближайшим сроком',
    description:
      'stage считается при чтении (ТЗ v4 раздел 8), «сегодня» по Europe/Berlin. q ищет в названии, ведомстве и номере.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'done', 'all'],
  })
  @ApiQuery({ name: 'q', required: false })
  @ApiOkResponse({ schema: { example: [SUMMARY] } })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(ListCasesQuerySchema)) query: ListCasesQuery,
  ): Promise<CaseSummary[]> {
    return this.cases.list(auth.cabinetId, query);
  }

  @Get('cases/:id')
  @ApiOperation({
    summary: 'Дело: письма, действующие факты, сроки, черновики, история',
  })
  @ApiOkResponse({
    schema: {
      example: {
        ...SUMMARY,
        letters: [],
        claims: [],
        deadlines: [],
        drafts: [],
        timeline: [],
      },
    },
  })
  @ApiNotFoundResponse(NOT_FOUND)
  detail(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<CaseDetail> {
    return this.cases.detail(auth.cabinetId, id);
  }

  @Patch('cases/:id')
  @ApiOperation({
    summary: 'Переименовать дело, завершить (CLOSED) или открыть снова (OPEN)',
  })
  @ApiBody({ schema: { example: { status: 'CLOSED' } } })
  @ApiNotFoundResponse(NOT_FOUND)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(UpdateCaseSchema)) body: UpdateCaseInput,
  ): Promise<CaseDetail> {
    return this.cases.update(auth.cabinetId, id, body);
  }

  @Delete('cases/:id')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Удалить дело вместе с письмами, фактами, сроками, файлами и журналом модели по нему',
  })
  @ApiNoContentResponse({ description: 'Удалено' })
  @ApiNotFoundResponse(NOT_FOUND)
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<void> {
    await this.cases.remove(auth.cabinetId, id);
  }

  @Get('cases/:id/trace')
  @ApiOperation({
    summary:
      'Вызовы модели по текущим письмам дела (замаскированные), только владельцу',
  })
  @ApiNotFoundResponse(NOT_FOUND)
  trace(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<TraceItem[]> {
    return this.cases.trace(auth.cabinetId, id);
  }

  @Get('history')
  @ApiOperation({
    summary: 'История всех дел: по убыванию времени, по 30 событий',
    description:
      'type: letter (письмо получено, факты, исправления) | case (дело создано, срок выполнен) | question | draft. ' +
      'Каждое событие ровно в одной группе. cursor: nextCursor из прошлой страницы.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['letter', 'case', 'question', 'draft'],
  })
  @ApiQuery({ name: 'cursor', required: false })
  history(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(HistoryQuerySchema)) query: HistoryQuery,
  ): Promise<{ items: HistoryItem[]; nextCursor: string | null }> {
    return this.cases.history(auth.cabinetId, query);
  }
}
