import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthContext } from '../auth/auth.service.js';
import { CurrentAuth, Public } from '../auth/session.guard.js';
import { IpLimit } from '../common/ip-limits.js';
import { ZodPipe } from '../common/zod.pipe.js';
import {
  AskSchema,
  CHAT_DISCLAIMER,
  PublicAskSchema,
  type AskInput,
  type PublicAskInput,
  type PublicChatReply,
  type ChatReply,
  type ChatView,
} from './chat.dto.js';
import { ChatService } from './chat.service.js';

const example = {
  id: 'cm0chat1',
  role: 'ASSISTANT',
  text: 'Anmeldung (регистрация по месту жительства) делают в Bürgeramt в течение двух недель после переезда…',
  createdAt: '2026-11-24T12:00:00.000Z',
};

@ApiTags('Чат-помощник')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  @Get()
  @ApiOperation({
    summary: 'История разговора с Ja!sno (последние 100 сообщений, по порядку)',
  })
  @ApiOkResponse({
    schema: { example: { disclaimer: CHAT_DISCLAIMER, messages: [example] } },
  })
  history(@CurrentAuth() auth: AuthContext): Promise<ChatView> {
    return this.chat.history(auth.cabinetId);
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Задать вопрос Ja!sno',
    description:
      'Свободный вопрос, без привязки к письму. Ja!sno отвечает по FAQ и общим знаниям о Германии. ' +
      'Под каждым ответом сайт показывает `disclaimer`. Нужно согласие на анализ ИИ. ' +
      'Отдельный лимит: LLM_DAILY_CHAT_PER_CABINET вопросов за 24 часа (429 RATE_LIMITED, reason LLM_DAILY_CHAT).',
  })
  @ApiBody({ schema: { example: { text: 'Как сделать Anmeldung после переезда?' } } })
  @ApiOkResponse({
    schema: {
      example: {
        disclaimer: CHAT_DISCLAIMER,
        question: { ...example, id: 'cm0chat0', role: 'USER', text: 'Как сделать Anmeldung после переезда?' },
        answer: example,
      },
    },
  })
  ask(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(AskSchema)) body: AskInput,
  ): Promise<ChatReply> {
    return this.chat.ask(auth.cabinetId, body.text);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Очистить разговор: удаляет все сообщения чата кабинета' })
  @ApiNoContentResponse()
  async clear(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.chat.clear(auth.cabinetId);
  }
}

/** KORR 25.11: чат на главной для гостей. Тот же помощник, без входа и без сохранения. */
@ApiTags('Чат-помощник')
@Controller('chat/public')
export class PublicChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  @Public()
  @Post()
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @IpLimit('publicChat')
  @ApiOperation({
    summary: 'Вопрос Ja!sno без входа (главная страница)',
    description:
      'Ничего не сохраняется: прошлые реплики (до 6) присылает сайт в history. ' +
      'Лимит 20 вопросов в час с одного IP (429). Под ответом сайт показывает `disclaimer`.',
  })
  @ApiBody({
    schema: {
      example: {
        text: 'Что такое Anmeldung?',
        history: [],
      },
    },
  })
  @ApiOkResponse({
    schema: { example: { disclaimer: CHAT_DISCLAIMER, answer: example.text } },
  })
  ask(@Body(new ZodPipe(PublicAskSchema)) body: PublicAskInput): Promise<PublicChatReply> {
    return this.chat.askPublic(body);
  }
}
