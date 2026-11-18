// Запускает API для браузерных тестов: своя схема, LLM_MODE=demo, без локальных .env.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { API_DIR, dropSchemas, migrate, schemaUrl } from './db.mjs';

const schema = process.env.JASNO_E2E_SCHEMA;
if (!schema)
  throw new Error(
    'JASNO_E2E_SCHEMA не задана (её задаёт playwright.config.ts)',
  );

await dropSchemas({ olderThanMs: 60 * 60 * 1000 }).catch(() => undefined);
migrate(schema);

// Live-прогон (pnpm e2e:live): из api/.env берутся только настройки модели. База и хранилище — тестовые.
const MODEL_KEYS = [
  'LLM_MODE',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_TIMEOUT_MS',
];
let model = { LLM_MODE: 'demo' };
if (process.env.JASNO_E2E_LIVE === '1') {
  const file = resolve(API_DIR, '.env');
  if (!existsSync(file))
    throw new Error('e2e:live: нет api/.env с настройками модели');
  const all = parseEnv(readFileSync(file, 'utf8'));
  // Значение из окружения важнее файла: можно один раз запустить с другой моделью (LLM_MODEL=… pnpm e2e:live).
  model = Object.fromEntries(
    MODEL_KEYS.map((k) => [k, process.env[k] ?? all[k]]).filter((e) => e[1]),
  );
  console.log(
    `e2e:live: модель ${model.LLM_MODE ?? '?'} / ${model.LLM_MODEL ?? '?'} (ключ не выводится)`,
  );
}

const child = spawn(process.execPath, [resolve(API_DIR, 'dist', 'main.js')], {
  stdio: 'inherit',
  env: {
    PATH: process.env.PATH,
    JASNO_SKIP_ENV_FILES: '1',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: process.env.JASNO_E2E_API_PORT,
    DATABASE_URL: schemaUrl(schema),
    ...model,
    CORS_ORIGIN: process.env.JASNO_E2E_WEB_URL,
    STORAGE_DIR: resolve(API_DIR, 'storage-e2e'),
    // B18: браузерные тесты регистрируют много пользователей с одного IP; лимиты проверяют e2e API
    RATE_LIMIT_IP: 'false',
    LLM_DAILY_OPS_PER_CABINET: '1000',
  },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
