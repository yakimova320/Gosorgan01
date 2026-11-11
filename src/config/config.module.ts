import { Global, Module } from '@nestjs/common';
import {
  ConfigModule as NestConfigModule,
  ConfigService,
} from '@nestjs/config';
import { z } from 'zod';
export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('127.0.0.1'),
    DATABASE_URL: z.string().min(1).default('file:./dev.db'),
    LLM_MODE: z.enum(['demo', 'openai']).default('demo'),
    LLM_API_KEY: z.string().optional(),
    LLM_MODEL: z.string().default('gpt-4.1-mini'),
    LLM_BASE_URL: z.url().default('https://api.openai.com/v1'),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    OCR_MIN_TEXT: z.coerce.number().int().positive().default(200),
    OCR_MIN_CONFIDENCE: z.coerce.number().min(0).max(100).default(60),
    OCR_QUOTE_DISTANCE: z.coerce.number().min(0).max(0.15).default(0.03),
    OCR_LANG_PATH: z.string().default('./.cache/tessdata'),
    PDFTOPPM_PATH: z.string().default('pdftoppm'),
  })
  .superRefine((v, ctx) => {
    if (v.LLM_MODE === 'openai' && !v.LLM_API_KEY)
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_API_KEY'],
        message: 'Required in openai mode',
      });
    if (v.NODE_ENV === 'production' && v.LLM_MODE === 'demo')
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_MODE'],
        message: 'Demo provider is forbidden in production',
      });
  });
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => {
        const result = environmentSchema.safeParse(env);
        if (!result.success)
          throw new Error(
            'Invalid environment: ' +
              result.error.issues
                .map((i) => `${i.path.join('.')}: ${i.message}`)
                .join('; '),
          );
        return result.data;
      },
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
export { ConfigService };
