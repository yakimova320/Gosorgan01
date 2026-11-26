import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth } from '../auth/session.guard.js';
import { CHAT_DISCLAIMER } from '../chat/chat.dto.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ArchiveAskSchema, type ArchiveAskInput, type ArchiveReply } from './archive.dto.js';
import { ArchiveService } from './archive.service.js';

@ApiTags('Вопросы к архиву')
@ApiBearerAuth()
@Controller('archive')
export class ArchiveController {
  constructor(@Inject(ArchiveService) private readonly archive: ArchiveService) {}

  @Post('ask')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Вопрос к своим письмам (L05, RAG)',
    description:
      'Ja!sno ищет ответ только в письмах своего кабинета (pgvector) и отвечает по найденным кускам. ' +
      'Под ответом — письма-источники с точными цитатами (код проверяет, что цитата есть в письме). ' +
      'Ничего не сохраняется, кроме векторов писем. Нужно согласие на анализ ИИ. ' +
      'Не больше 3 обращений к модели; лимит общий с чатом: LLM_DAILY_CHAT_PER_CABINET (429 RATE_LIMITED).',
  })
  @ApiBody({ schema: { example: { text: 'Что от меня хочет Jobcenter?' } } })
  @ApiOkResponse({
    schema: {
      example: {
        disclaimer: CHAT_DISCLAIMER,
        answer: 'Jobcenter просит прислать выписки со счёта до 12.12.2026 (письмо «Mitwirkung» от 20.11.2026).',
        sources: [
          {
            letterId: 'cm0letter1',
            letterTitle: 'Mitwirkung: Kontoauszüge',
            letterCreatedAt: '2026-11-20T10:00:00.000Z',
            caseId: 'cm0case1',
            caseTitle: 'Jobcenter: Weiterbewilligung',
            quote: 'Bitte senden Sie uns die Kontoauszüge der letzten drei Monate bis zum 12.12.2026.',
          },
        ],
        terms: [{ term: 'Mitwirkungspflicht', text: 'Обязанность помогать ведомству…' }],
        pendingLetters: 0,
      },
    },
  })
  ask(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(ArchiveAskSchema)) body: ArchiveAskInput,
  ): Promise<ArchiveReply> {
    return this.archive.ask(auth.cabinetId, body.text);
  }
}
