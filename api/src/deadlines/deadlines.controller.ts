import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
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
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/session.guard.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DeadlinesService, type DeadlineState } from './deadlines.service.js';

const PatchDeadlineSchema = z.object({ done: z.boolean() }).strict();

const err = (code: string, message: string) => ({
  schema: { example: { code, message } },
});

@ApiTags('Сроки')
@ApiBearerAuth()
@Controller('deadlines')
export class DeadlinesController {
  constructor(
    @Inject(DeadlinesService) private readonly deadlines: DeadlinesService,
  ) {}

  @Patch(':id')
  @ApiOperation({
    summary: 'Отметить срок выполненным или снова открыть (B12)',
    description:
      'Только подтверждённый срок владельца. Повтор того же значения ничего не меняет. События: DEADLINE_DONE, при отмене — REVISION.',
  })
  @ApiBody({ schema: { example: { done: true } } })
  @ApiOkResponse({
    schema: {
      example: { id: 'cm0dl1', caseId: 'cm0case1', date: '2026-11-30', done: true },
    },
  })
  @ApiNotFoundResponse(err('NOT_FOUND', 'Не найдено'))
  @ApiConflictResponse(
    err('DEADLINE_NOT_CONFIRMED', 'Срок ещё не подтверждён. Сначала подтвердите его в фактах письма'),
  )
  patch(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
    @Body(new ZodPipe(PatchDeadlineSchema)) body: { done: boolean },
  ): Promise<DeadlineState> {
    return this.deadlines.setDone(auth.cabinetId, id, body.done);
  }

  @Get(':id/ics')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Срок в календарь: файл .ics (text/calendar), событие на весь день и напоминание (B12)',
  })
  @ApiOkResponse({ description: 'text/calendar; charset=utf-8' })
  @ApiNotFoundResponse(err('NOT_FOUND', 'Не найдено'))
  @ApiConflictResponse(
    err('DEADLINE_NOT_CONFIRMED', 'Срок ещё не подтверждён. Сначала подтвердите его в фактах письма'),
  )
  async ics(
    @CurrentAuth() auth: AuthContext,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const text = await this.deadlines.ics(auth.cabinetId, id);
    return new StreamableFile(Buffer.from(text, 'utf8'), {
      type: 'text/calendar; charset=utf-8',
      disposition: 'attachment; filename="jasno-srok.ics"',
    });
  }
}
