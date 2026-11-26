import { isIP } from 'node:net';
import { z } from 'zod';

/** Элемент TRUST_PROXY: имя подсети Express, IP или подсеть CIDR. */
export function isTrustedProxyEntry(entry: string): boolean {
  if (['loopback', 'linklocal', 'uniquelocal'].includes(entry)) return true;
  const [ip, bits, extra] = entry.split('/');
  if (extra !== undefined || !isIP(ip)) return false;
  if (bits === undefined) return true;
  const max = isIP(ip) === 4 ? 32 : 128;
  return /^\d+$/.test(bits) && Number(bits) <= max;
}

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const int = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

/**
 * Все переменные окружения сервера (ТЗ v2 раздел 6, ТЗ v4 раздел 7).
 * Проверяются один раз при старте: ошибка в .env останавливает сервер с понятным текстом.
 */
export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: int(3000),
    DATABASE_URL: z
      .string()
      .regex(
        /^postgres(ql)?:\/\//,
        'DATABASE_URL: нужен адрес PostgreSQL (postgresql://...)',
      )
      .default('postgresql://jasno:jasno@localhost:5432/jasno'),
    // A03/B18: доверенные прокси перед API, только явные адреса: loopback, linklocal, uniquelocal,
    // IP или подсеть (10.0.0.0/8), через запятую. Число шагов и true не принимаются: тогда клиент
    // мог бы подставить свой IP в X-Forwarded-For. Пусто: заголовок не учитывается.
    TRUST_PROXY: z
      .string()
      .optional()
      .refine((v) => v === undefined || v.split(',').every((p) => isTrustedProxyEntry(p.trim())), {
        message:
          'только loopback, linklocal, uniquelocal, IP или подсеть через запятую (число шагов и true нельзя)',
      }),
    // B18: лимиты по IP (@nestjs/throttler). false только для тестов, в production запрещено.
    RATE_LIMIT_IP: bool.default(true),
    CORS_ORIGIN: z
      .string()
      .default('http://localhost:5173')
      .transform((v) =>
        v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    LLM_MODE: z.enum(['demo', 'openai']).default('demo'),
    LLM_BASE_URL: z.url().optional(),
    LLM_API_KEY: z.string().optional(),
    LLM_MODEL: z.string().optional(),
    LLM_MODEL_ASSISTANT: z.string().optional(),
    // L05 (#81): векторы для вопросов к архиву. local — без модели и сети (работает и с Anthropic,
    // у которого нет /embeddings). api — OpenAI-совместимый /embeddings (Gemini: gemini-embedding-001).
    LLM_EMBED_MODE: z.enum(['local', 'api']).default('local'),
    LLM_EMBED_MODEL: z.string().min(1).default('gemini-embedding-001'),
    LLM_EMBED_BASE_URL: z.url().optional(),
    LLM_EMBED_API_KEY: z.string().optional(),
    LLM_TIMEOUT_MS: int(60000),

    STORAGE_DIR: z.string().min(1).default('./storage'),
    // ST01: где лежат оригиналы писем. local: папка STORAGE_DIR/letters. s3: бакет (Supabase Storage).
    // Письма сброса пароля (mail-outbox) всегда в папке STORAGE_DIR.
    STORAGE_MODE: z.enum(['local', 's3']).default('local'),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/, 'S3_BUCKET: имя бакета, без / и пробелов')
      .optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    // B13: папка собранного сайта (web/dist). Задана — API отдаёт и сайт (Docker). Пусто — только API.
    WEB_DIST_DIR: z.string().optional(),
    SESSION_TTL_DAYS: int(30),
    CABINET_TTL_DAYS: int(360), // поправка 12 (23.11): 360 дней без входа

    APP_PUBLIC_URL: z.url().default('http://localhost:5173'),
    MAIL_MODE: z.enum(['file', 'smtp']).default('file'),
    MAIL_FROM: z.string().default('Ja!sno <no-reply@example.org>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_SECURE: bool.optional(),
    RESET_TOKEN_TTL_MIN: int(60),
    // K12: фоновые напоминания о сроках по e-mail (раз в 15 минут, с 8 до 21 по Берлину). false — выключены.
    REMINDERS_ENABLED: bool.default(true),
    SUPPORT_EMAIL: z.string().optional(),

    // B18: операций с моделью (загрузка письма, объяснение) на кабинет за скользящие 24 часа. 0 — без лимита.
    LLM_DAILY_OPS_PER_CABINET: z.coerce.number().int().min(0).default(30),
    // Чат-помощник (24.11): сообщений в чат на кабинет за скользящие 24 часа, отдельно от писем. 0 — без лимита.
    LLM_DAILY_CHAT_PER_CABINET: z.coerce.number().int().min(0).default(50),
    // Папка с текстами команды (FAQ для чат-помощника). По умолчанию content/ рядом с папкой api.
    CONTENT_DIR: z.string().optional(),
    // B18: мягкий общий порог токенов за 24 часа (все кабинеты). 0 — выключен. Не гарантия расходов.
    LLM_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(0).default(0),

    UPLOAD_MAX_FILE_MB: int(10),
    UPLOAD_MAX_LETTER_MB: int(20),
    UPLOAD_MAX_FILES: int(10),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_MODE === 'openai') {
      for (const key of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `нужно при LLM_MODE=openai`,
          });
        }
      }
    }
    if (env.STORAGE_MODE === 's3') {
      for (const key of [
        'S3_ENDPOINT',
        'S3_REGION',
        'S3_BUCKET',
        'S3_ACCESS_KEY_ID',
        'S3_SECRET_ACCESS_KEY',
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'нужно при STORAGE_MODE=s3',
          });
        }
      }
    }
    if (env.MAIL_MODE === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_HOST'],
        message: 'нужно при MAIL_MODE=smtp',
      });
    }
    if (env.NODE_ENV === 'production' && !env.RATE_LIMIT_IP) {
      ctx.addIssue({
        code: 'custom',
        path: ['RATE_LIMIT_IP'],
        message: 'в production лимиты по IP выключать нельзя',
      });
    }
    if (env.NODE_ENV === 'production' && env.MAIL_MODE === 'file') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_MODE'],
        message:
          'режим file запрещён в production: ссылки восстановления пароля лежали бы в файлах',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Читает и проверяет окружение. Пустые строки считаются отсутствующими. */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  ${i.path.join('.') || '(env)'}: ${i.message}`,
    );
    throw new Error(
      `Ошибка в переменных окружения (.env):\n${lines.join('\n')}`,
    );
  }
  return result.data;
}
