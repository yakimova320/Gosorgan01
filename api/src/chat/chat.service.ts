import { Inject, Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertAiConsent } from '../cabinet/ai-consent.js';
import { ApiError } from '../common/api-error.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { LlmService } from '../llm/llm.service.js';
import { ChatAnswerSchema } from '../llm/schemas/chat.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CHAT_DISCLAIMER,
  CHAT_HISTORY_LIMIT,
  type ChatMessageView,
  type ChatReply,
  type ChatView,
  type PublicAskInput,
  type PublicChatReply,
} from './chat.dto.js';

/** Сколько последних сообщений модель видит как контекст разговора. */
const CONTEXT_MESSAGES = 10;
/** Длинные старые ответы в контексте обрезаются: экономия токенов. */
const CONTEXT_CHARS = 800;

/**
 * Чат-помощник (24.11): свободный разговор без привязки к письму. Отвечает по FAQ Ja!sno и
 * общим знаниям о Германии. Под каждым ответом сайт показывает пометку CHAT_DISCLAIMER.
 * Обращение к модели — через LlmService (маскирование, журнал LlmCall, лимит операций CHAT).
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger('ChatService');
  private faqCache: string | null = null;

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(LlmService) private readonly llm: LlmService,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  /** FAQ из content/faq.ru.md (тексты пишет команда). Нет файла — чат работает без FAQ. */
  private faq(): string {
    if (this.faqCache !== null) return this.faqCache;
    const dir = this.config.CONTENT_DIR ?? resolve(process.cwd(), '..', 'content');
    try {
      this.faqCache = readFileSync(resolve(dir, 'faq.ru.md'), 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();
    } catch {
      this.logger.warn(`FAQ не найден в ${dir}: чат отвечает без него`);
      this.faqCache = '';
    }
    // KORR 25.11: «Горячие темы» блога тоже в контексте — проверенные короткие тексты с датой проверки
    try {
      const data = JSON.parse(
        readFileSync(resolve(dir, 'important', 'cards.ru.json'), 'utf8'),
      ) as { cards: { topic: string; title: string; text: string; checkedAt: string; draft?: boolean }[] };
      const hot = data.cards.filter((c) => c.topic === 'hot' && !c.draft);
      if (hot.length)
        this.faqCache += `\n\n## Горячие темы (блог Ja!sno)\n\n${hot
          .map((c) => `### ${c.title}\n${c.text}\n(проверено ${c.checkedAt})`)
          .join('\n\n')}`;
    } catch {
      this.logger.warn(`карточки блога не найдены в ${dir}: чат отвечает без них`);
    }
    return this.faqCache;
  }

  async history(cabinetId: string): Promise<ChatView> {
    const rows = await this.db.chatMessage.findMany({
      where: { cabinetId },
      orderBy: { createdAt: 'desc' },
      take: CHAT_HISTORY_LIMIT,
    });
    return { disclaimer: CHAT_DISCLAIMER, messages: rows.reverse().map(toView) };
  }

  async ask(cabinetId: string, text: string): Promise<ChatReply> {
    await assertAiConsent(this.db, cabinetId);
    const recent = await this.db.chatMessage.findMany({
      where: { cabinetId },
      orderBy: { createdAt: 'desc' },
      take: CONTEXT_MESSAGES,
    });
    const history = recent
      .reverse()
      .map(
        (m) =>
          `${m.role === 'USER' ? 'Пользователь' : 'Ja!sno'}: ${
            m.text.length > CONTEXT_CHARS ? `${m.text.slice(0, CONTEXT_CHARS)}…` : m.text
          }`,
      )
      .join('\n\n');

    const result = await this.llm.call({
      prompt: 'chat',
      version: 1,
      variables: { faq: this.faq(), history, question: text },
      schema: ChatAnswerSchema,
      context: { cabinetId },
      operation: this.llm.operation(cabinetId, 'CHAT'),
      ...(this.config.LLM_MODEL_ASSISTANT
        ? { model: this.config.LLM_MODEL_ASSISTANT }
        : {}),
    });

    // вопрос и ответ сохраняются вместе: без ответа модели вопрос в историю не попадает
    const [question, answer] = await this.db.$transaction(async (tx) => {
      const exists = await tx.cabinet.count({ where: { id: cabinetId } });
      if (!exists) throw new ApiError('UNAUTHORIZED');
      const q = await tx.chatMessage.create({
        data: { cabinetId, role: 'USER', text },
      });
      const a = await tx.chatMessage.create({
        // на миллисекунду позже вопроса: порядок в истории не зависит от часов базы
        data: {
          cabinetId,
          role: 'ASSISTANT',
          text: result.answer,
          createdAt: new Date(q.createdAt.getTime() + 1),
        },
      });
      return [q, a];
    });
    return { disclaimer: CHAT_DISCLAIMER, question: toView(question), answer: toView(answer) };
  }

  /**
   * KORR 25.11: вопрос с главной, без входа и без сохранения. Лимит по IP в контроллере,
   * общий дневной бюджет токенов — в LlmService. Вызов пишется в LlmCall с cabinetId null.
   */
  async askPublic(input: PublicAskInput): Promise<PublicChatReply> {
    const history = input.history
      .map(
        (m) =>
          `${m.role === 'USER' ? 'Пользователь' : 'Ja!sno'}: ${
            m.text.length > CONTEXT_CHARS ? `${m.text.slice(0, CONTEXT_CHARS)}…` : m.text
          }`,
      )
      .join('\n\n');
    const result = await this.llm.call({
      prompt: 'chat',
      version: 1,
      variables: { faq: this.faq(), history, question: input.text },
      schema: ChatAnswerSchema,
      context: { cabinetId: null },
      operation: this.llm.operation(null, 'CHAT'),
      ...(this.config.LLM_MODEL_ASSISTANT
        ? { model: this.config.LLM_MODEL_ASSISTANT }
        : {}),
    });
    return { disclaimer: CHAT_DISCLAIMER, answer: result.answer };
  }

  async clear(cabinetId: string): Promise<void> {
    await this.db.chatMessage.deleteMany({ where: { cabinetId } });
  }
}

function toView(m: {
  id: string;
  role: 'USER' | 'ASSISTANT';
  text: string;
  createdAt: Date;
}): ChatMessageView {
  return { id: m.id, role: m.role, text: m.text, createdAt: m.createdAt.toISOString() };
}
