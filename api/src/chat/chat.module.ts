import { Module } from '@nestjs/common';
import { ChatController, PublicChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

/** Чат-помощник (24.11); на главной без входа (KORR 25.11). */
@Module({
  controllers: [PublicChatController, ChatController],
  providers: [ChatService],
})
export class ChatModule {}
