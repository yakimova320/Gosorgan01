import { Inject, Injectable, Logger } from '@nestjs/common';
import { resolve } from 'node:path';
import { assertAiConsent } from '../cabinet/ai-consent.js';
import { CHAT_DISCLAIMER } from '../chat/chat.dto.js';
import { cabinetLanguage, languageVariables, type Language } from '../common/language.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { LlmService } from '../llm/llm.service.js';
import { ArchiveAnswerSchema, ArchiveQuerySchema } from '../llm/schemas/archive.schema.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ArchiveReply, ArchiveSource } from './archive.dto.js';
import { ArchiveRepository } from './archive.repository.js';
import { splitLetter, textHash } from './chunking.js';
import { loadCheckedTerms, termsIn, type GlossaryTerm } from './glossary.js';

/** Сколько кусков отдаётся модели как контекст. */
export const TOP_CHUNKS = 6;
/** Не больше текстов в одном обращении за векторами (вопрос + куски писем). */
export const EMBED_BATCH = 90;
/** Не больше источников под ответом. */
const MAX_SOURCES = 4;

const NO_LETTERS: Record<Language, string> = {
  ru: 'В вашем кабинете пока нет писем. Загрузите письмо, и после этого можно задавать вопросы по нему.',
  uk: 'У вашому кабінеті поки немає листів. Завантажте лист, і після цього можна ставити запитання про нього.',
  de: 'In Ihrem Konto gibt es noch keine Briefe. Laden Sie einen Brief hoch. Danach können Sie Fragen dazu stellen.',
};

/** Сравнение цитаты с письмом: пробелы и переносы строк не важны, регистр важен. */
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

const dateDe = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;

/**
 * L05 (#81): вопросы к архиву писем (RAG).
 * 1. Письма кабинета без векторов (или с изменённым текстом) режутся на куски.
 * 2. Векторы вопроса и новых кусков (LlmService.embed). Локальные векторы (по умолчанию) ищут по словам,
 *    поэтому вопрос сначала переводится в немецкие слова писем (archive-query.v1, одно обращение).
 *    Внешние векторы (LLM_EMBED_MODE=api) — одно обращение за векторами.
 * 3. Код ищет ближайшие куски только среди писем этого кабинета (pgvector, WHERE cabinetId).
 * 4. Второе обращение: ответ модели по кускам (archive.v1), Zod.
 * 5. Код оставляет только цитаты, которые есть в тексте письма.
 * Не больше 3 обращений на вопрос (операция CHAT, лимит LLM_DAILY_CHAT_PER_CABINET).
 */
@Injectable()
export class ArchiveService {
  private readonly logger = new Logger('ArchiveService');
  private terms: GlossaryTerm[] | null = null;

  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(LlmService) private readonly llm: LlmService,
    @Inject(ArchiveRepository) private readonly repo: ArchiveRepository,
    @Inject(APP_CONFIG) private readonly config: Env,
  ) {}

  private glossary(): GlossaryTerm[] {
    this.terms ??= loadCheckedTerms(
      this.config.CONTENT_DIR ?? resolve(process.cwd(), '..', 'content'),
    );
    return this.terms;
  }

  async ask(cabinetId: string, question: string): Promise<ArchiveReply> {
    await assertAiConsent(this.db, cabinetId);
    const lang = await cabinetLanguage(this.db, cabinetId);
    const letters = await this.db.letter.findMany({
      where: { cabinetId },
      select: {
        id: true,
        rawText: true,
        title: true,
        createdAt: true,
        caseId: true,
        case: { select: { title: true } },
        chunks: { select: { textHash: true }, where: { n: 0 }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (letters.length === 0)
      return { disclaimer: CHAT_DISCLAIMER, answer: NO_LETTERS[lang], sources: [], terms: [], pendingLetters: 0 };

    // 1. письма без векторов: новые и с изменённым текстом, сначала свежие
    const batch: { letterId: string; hash: string; chunks: string[] }[] = [];
    let room = EMBED_BATCH - 1;
    let pendingLetters = 0;
    for (const l of letters) {
      // источник векторов входит в отпечаток: при его смене куски считаются заново
      const hash = textHash(`${this.llm.embedderId}\n${l.rawText}`);
      if (l.chunks[0]?.textHash === hash) continue;
      const chunks = splitLetter(l.rawText);
      if (chunks.length === 0) continue;
      if (chunks.length > room) {
        pendingLetters++;
        continue;
      }
      room -= chunks.length;
      batch.push({ letterId: l.id, hash, chunks });
    }

    // 2. векторы вопроса и новых кусков
    const op = this.llm.operation(cabinetId, 'CHAT');
    let searchText = question;
    if (this.llm.embedsLocally) {
      const q = await this.llm.call({
        prompt: 'archive-query',
        version: 1,
        variables: { question },
        schema: ArchiveQuerySchema,
        context: { cabinetId },
        operation: op,
        maxAttempts: 2, // ещё одно обращение остаётся на ответ
      });
      searchText = `${question}\n${q.query}`;
    }
    const vectors = await this.llm.embed({
      texts: [searchText, ...batch.flatMap((b) => b.chunks)],
      context: { cabinetId },
      operation: op,
      maxAttempts: 2, // ещё одно обращение остаётся на ответ
    });
    const [qVector, ...chunkVectors] = vectors;
    let at = 0;
    for (const b of batch) {
      const chunks = b.chunks.map((text) => ({ text, vector: chunkVectors[at++] }));
      const saved = await this.repo.replaceChunks(cabinetId, b.letterId, b.hash, chunks);
      if (!saved) this.logger.log('куски письма не записаны: письмо удалено или аккаунт удаляется');
    }

    // 3. поиск только по письмам этого кабинета
    const hits = await this.repo.search(cabinetId, qVector, TOP_CHUNKS);
    const byId = new Map(letters.map((l) => [l.id, l]));
    const found = hits.filter((h) => byId.has(h.letterId));
    if (found.length === 0)
      return { disclaimer: CHAT_DISCLAIMER, answer: NO_LETTERS[lang], sources: [], terms: [], pendingLetters };

    const fragments = found
      .map((h, i) => {
        const l = byId.get(h.letterId)!;
        return `### F${i + 1}\nПисьмо: «${l.title ?? 'без названия'}» · ${dateDe(l.createdAt)}\n${h.text}`;
      })
      .join('\n\n');
    const terms = termsIn(`${searchText}\n${fragments}`, this.glossary());

    // 4. ответ модели по кускам
    const result = await this.llm.call({
      prompt: 'archive',
      version: 1,
      variables: {
        question,
        fragments,
        terms: terms.map((t) => `${t.term}: ${t.text[lang] || t.text.ru}`).join('\n'),
        ...languageVariables(lang),
      },
      schema: ArchiveAnswerSchema,
      context: { cabinetId },
      operation: op,
      ...(this.config.LLM_MODEL_ASSISTANT ? { model: this.config.LLM_MODEL_ASSISTANT } : {}),
    });

    // 5. только цитаты, которые есть в самом письме
    const sources: ArchiveSource[] = [];
    const seen = new Set<string>();
    for (const s of result.sources) {
      const hit = found[Number(s.fragment.slice(1)) - 1];
      const letter = hit && byId.get(hit.letterId);
      if (!letter) continue;
      const quote = flat(s.quote);
      if (!quote || !flat(letter.rawText).includes(quote)) continue;
      const key = `${letter.id}\n${quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        letterId: letter.id,
        letterTitle: letter.title,
        letterCreatedAt: letter.createdAt.toISOString(),
        caseId: letter.caseId,
        caseTitle: letter.case?.title ?? null,
        quote,
      });
      if (sources.length >= MAX_SOURCES) break;
    }
    const dropped = result.sources.length - sources.length;
    if (dropped > 0) this.logger.log(`archive: ${dropped} источник(ов) без цитаты в письме убраны`);

    return {
      disclaimer: CHAT_DISCLAIMER,
      answer: result.answer,
      sources,
      terms: terms.map((t) => ({ term: t.term, text: t.text[lang] || t.text.ru })),
      pendingLetters,
    };
  }
}
