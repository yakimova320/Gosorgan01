import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const int = (fallback: number) => z.coerce.number().int().positive().default(fallback);

/**
 * Все переменные окружения сервера (ТЗ v2 раздел 6, ТЗ v4 раздел 7).
 * Проверяются один раз при старте: ошибка в .env останавливает сервер с понятным текстом.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: int(3000),
    DATABASE_URL: z.string().min(1).default('file:./dev.db'),
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
    LLM_TIMEOUT_MS: int(60000),

    STORAGE_DIR: z.string().min(1).default('./storage'),
    SESSION_TTL_DAYS: int(30),
    CABINET_TTL_DAYS: int(90),

    APP_PUBLIC_URL: z.url().default('http://localhost:5173'),
    MAIL_MODE: z.enum(['file', 'smtp']).default('file'),
    MAIL_FROM: z.string().default('Ja!sno <no-reply@example.org>'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_SECURE: bool.optional(),
    RESET_TOKEN_TTL_MIN: int(60),
    SUPPORT_EMAIL: z.string().optional(),

    UPLOAD_MAX_FILE_MB: int(10),
    UPLOAD_MAX_LETTER_MB: int(20),
    UPLOAD_MAX_FILES: int(10),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_MODE === 'openai') {
      for (const key of ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: 'custom', path: [key], message: `нужно при LLM_MODE=openai` });
        }
      }
    }
    if (env.MAIL_MODE === 'smtp' && !env.SMTP_HOST) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'нужно при MAIL_MODE=smtp' });
    }
    if (env.NODE_ENV === 'production' && env.MAIL_MODE === 'file') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_MODE'],
        message: 'режим file запрещён в production: ссылки восстановления пароля лежали бы в файлах',
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
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Ошибка в переменных окружения (.env):\n${lines.join('\n')}`);
  }
  return result.data;
}
