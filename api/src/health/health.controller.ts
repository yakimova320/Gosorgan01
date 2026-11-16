import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.schema.js';
import { Public } from '../auth/session.guard.js';

export interface HealthResponse {
  ok: true;
  /** demo: ответы без настоящей модели; openai: настоящая модель */
  llmMode: Env['LLM_MODE'];
  version: string;
}

@ApiTags('Служебное')
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(APP_CONFIG) private readonly config: Env) {}

  @Get()
  @ApiOkResponse({
    description: 'Сервер работает. Секреты не показываются.',
    schema: { example: { ok: true, llmMode: 'demo', version: '0.1.0' } },
  })
  get(): HealthResponse {
    return { ok: true, llmMode: this.config.LLM_MODE, version: '0.1.0' };
  }
}
