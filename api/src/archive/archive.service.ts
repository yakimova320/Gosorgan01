import { Inject, Injectable, Logger } from '@nestjs/common';
import { resolve } from 'node:path';
import { assertAiConsent } from '../cabinet/ai-consent.js';
import { CHAT_DISCLAIMER } from '../chat/chat.dto.js';
import { cabinetLanguage, languageVariables, type Language } from '../common/language.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { LlmService } from '../llm/llm.service.js';
import { ArchiveAnswerSchema } from '../llm/schemas/archive.schema.js';
import { wordStems } from '../llm/local-embed.js';
import { VaultService } from '../crypto/vault.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ArchiveReply, ArchiveSource } from './archive.dto.js';
import { ArchiveRepository } from './archive.repository.js';
import { splitLetter } from './chunking.js';
import type { LetterSummaryText } from './summary-check.js';
import { loadCheckedTerms, termsIn, type GlossaryTerm } from './glossary.js';

/** Сколько писем находит поиск по резюме. */
export const TOP_LETTERS = 4;
/** Сколько кусков каждого найденного письма уходит модели вместе с резюме. */
export const CHUNKS_PER_LETTER = 2;
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
 * L05 (#81), E01 (#163): вопросы к архиву писем (RAG) без открытого текста в базе.
 * 1. Вектор вопроса (LlmService.embed; локальные векторы — без модели).
 * 2. Код ищет ближайшие резюме писем только этого кабинета (pgvector, WHERE cabinetId).
 *    Резюме обезличено и зашифровано, открыт только его вектор (extract.v5 при загрузке).
 * 3. Текст найденных писем открывается ключами из запроса: браузер присылает их по кнопке «Спросить»
 *    (428 KEYS_REQUIRED с нужными keyId → повтор с ключами). Модели уходят резюме и по 2 куска письма.
 * 4. Ответ модели (archive.v1), Zod. 5. Код оставляет только цитаты, которые есть в тексте письма.
 * Не больше 3 обращений на вопрос (операция CHAT, лимит LLM_DAILY_CHAT_PER_CABINET). Ничего не сохраняется.
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
    @Inject(VaultService) private readonly vault: VaultService,
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
    const total = await this.db.letter.count({ where: { cabinetId } });
    if (total === 0)
      return { disclaimer: CHAT_DISCLAIMER, answer: NO_LETTERS[lang], sources: [], terms: [], pendingLetters: 0 };
    // письма без резюме (загружены до E01 или резюме не прошло проверку) в поиск не попадают
    const pendingLetters = await this.db.letter.count({
      where: { cabinetId, summary: { is: null } },
    });

    // 1–2. вектор вопроса и поиск по резюме писем этого кабинета
    const op = this.llm.operation(cabinetId, 'CHAT');
    const [qVector] = await this.llm.embed({
      texts: [question],
      context: { cabinetId },
      operation: op,
      maxAttempts: 2, // ещё одно обращение остаётся на ответ
    });
    const hits = await this.repo.search(cabinetId, this.llm.embedderId, qVector!, TOP_LETTERS);
    const rows = await this.db.letter.findMany({
      where: { id: { in: hits.map((h) => h.letterId) }, cabinetId },
      select: {
        id: true,
        rawText: true,
        title: true,
        createdAt: true,
        caseId: true,
        case: { select: { title: true } },
        summary: { select: { summary: true } },
      },
    });
    if (rows.length === 0)
      return { disclaimer: CHAT_DISCLAIMER, answer: NO_LETTERS[lang], sources: [], terms: [], pendingLetters };

    // 3. текст найденных писем: только с ключами из запроса (иначе 428 KEYS_REQUIRED)
    const opened = await this.vault.open(cabinetId, rows);
    const byId = new Map(opened.map((l) => [l.id, l]));
    const found = hits.map((h) => byId.get(h.letterId)).filter((l) => l !== undefined);
    const fragments = found
      .map((l, i) => {
        const summary = readSummary(l.summary?.summary);
        const parts = bestChunks(l.rawText, `${question}\n${summary?.de ?? ''}`, CHUNKS_PER_LETTER);
        // резюме — в строке заголовка: цитаты берутся только из кусков самого письма
        return [
          `### F${i + 1}`,
          `Письмо: «${l.title ?? 'без названия'}» · ${dateDe(l.createdAt)}${summary ? ` · Кратко: ${summary.de}` : ''}`,
          ...parts,
        ].join('\n');
      })
      .join('\n\n');
    const terms = termsIn(`${question}\n${fragments}`, this.glossary());

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
      const letter = found[Number(s.fragment.slice(1)) - 1];
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

/** Куски письма с наибольшим числом общих основ слов с вопросом и резюме, в порядке письма. */
export function bestChunks(text: string, query: string, n: number): string[] {
  const want = new Set(wordStems(query));
  const chunks = splitLetter(text);
  return chunks
    .map((c, i) => ({ c, i, score: wordStems(c).filter((w) => want.has(w)).length }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, n)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.c);
}

/** Резюме из LetterSummary: после расшифровки — объект, у письма без шифрования — строка JSON. */
export function readSummary(raw: unknown): LetterSummaryText | undefined {
  if (!raw) return undefined;
  if (typeof raw !== 'string') return raw as LetterSummaryText;
  try {
    return JSON.parse(raw) as LetterSummaryText;
  } catch {
    return undefined;
  }
}
