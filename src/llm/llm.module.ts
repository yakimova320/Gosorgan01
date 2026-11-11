import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CasesModule } from '../cases/cases.module.js';
import { LlmService } from './llm.service.js';
import { PromptRegistry } from './prompt-registry.js';
import { TraceService } from './trace.service.js';
import { LLM_PROVIDER } from './provider.js';
import { DemoLlmProvider } from './demo.provider.js';
import { OpenAiProvider } from './openai.provider.js';
@Module({
  imports: [CasesModule],
  providers: [
    LlmService,
    PromptRegistry,
    TraceService,
    OpenAiProvider,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService, OpenAiProvider],
      useFactory: (config: ConfigService, openai: OpenAiProvider) =>
        config.get('LLM_MODE') === 'demo' ? new DemoLlmProvider() : openai,
    },
  ],
  exports: [LlmService, TraceService],
})
export class LlmModule {}
