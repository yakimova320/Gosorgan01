import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';

/** Чат-помощник (24.11). */
@Module({
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
