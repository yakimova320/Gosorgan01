import { Logger } from '@nestjs/common';
import { resolve } from 'node:path';
import { createApp } from './app.factory.js';
import { APP_CONFIG } from './config/config.module.js';
import type { Env } from './config/env.schema.js';
import { loadEnvFiles } from './config/load-env-files.js';

loadEnvFiles(resolve(import.meta.dirname, '..'));

const app = await createApp();
const config = app.get<Env>(APP_CONFIG);
await app.listen(config.PORT, config.HOST);

const base = `http://${config.HOST}:${config.PORT}`;
new Logger('Ja!sno').log(`API: ${base}  ·  Swagger: ${base}/docs  ·  LLM_MODE=${config.LLM_MODE}`);
