import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { DemoAdapter } from './adapters/demo.adapter.js';
import { OpenAiAdapter } from './adapters/openai.adapter.js';
import { EMBEDDER, LocalEmbedder, type Embedder } from './local-embed.js';
import { LLM_ADAPTER, type LlmAdapter } from './llm.types.js';
import { LlmLimitsService } from './llm-limits.service.js';
import { LlmService } from './llm.service.js';
import { MaskingService } from './masking.service.js';
import { PromptRegistry } from './prompt-registry.js';
import { TraceService } from './trace.service.js';

/** Адаптер выбирается по LLM_MODE. В demo сеть не используется. */
export function createAdapter(config: Env): LlmAdapter {
  if (config.LLM_MODE === 'openai') {
    return new OpenAiAdapter({
      baseUrl: config.LLM_BASE_URL as string,
      apiKey: config.LLM_API_KEY as string,
      model: config.LLM_MODEL as string,
      timeoutMs: config.LLM_TIMEOUT_MS,
    });
  }
  return new DemoAdapter();
}

/**
 * L05: источник векторов. local (по умолчанию) — без модели и без сети, работает с любым провайдером.
 * api — OpenAI-совместимый /embeddings (например Gemini), адрес и ключ LLM_EMBED_* или LLM_*.
 */
export function createEmbedder(config: Env): Embedder {
  if (config.LLM_EMBED_MODE !== 'api' || config.LLM_MODE !== 'openai') return new LocalEmbedder();
  const adapter = new OpenAiAdapter({
    baseUrl: (config.LLM_EMBED_BASE_URL ?? config.LLM_BASE_URL) as string,
    apiKey: (config.LLM_EMBED_API_KEY ?? config.LLM_API_KEY) as string,
    model: config.LLM_EMBED_MODEL,
    embedModel: config.LLM_EMBED_MODEL,
    timeoutMs: config.LLM_TIMEOUT_MS,
  });
  return { id: `api:${config.LLM_EMBED_MODEL}`, remote: true, embed: (r) => adapter.embed(r) };
}

@Global()
@Module({
  providers: [
    { provide: LLM_ADAPTER, useFactory: createAdapter, inject: [APP_CONFIG] },
    { provide: EMBEDDER, useFactory: createEmbedder, inject: [APP_CONFIG] },
    { provide: PromptRegistry, useFactory: () => new PromptRegistry() },
    MaskingService,
    TraceService,
    LlmLimitsService,
    LlmService,
  ],
  exports: [LlmService, LlmLimitsService, PromptRegistry, MaskingService],
})
export class LlmModule {}
