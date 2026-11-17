// Запускает API для браузерных тестов: своя схема, LLM_MODE=demo, без локальных .env.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { API_DIR, dropSchemas, migrate, schemaUrl } from './db.mjs';

const schema = process.env.JASNO_E2E_SCHEMA;
if (!schema)
  throw new Error(
    'JASNO_E2E_SCHEMA не задана (её задаёт playwright.config.ts)',
  );

await dropSchemas({ olderThanMs: 60 * 60 * 1000 }).catch(() => undefined);
migrate(schema);

const child = spawn(process.execPath, [resolve(API_DIR, 'dist', 'main.js')], {
  stdio: 'inherit',
  env: {
    PATH: process.env.PATH,
    JASNO_SKIP_ENV_FILES: '1',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: process.env.JASNO_E2E_API_PORT,
    DATABASE_URL: schemaUrl(schema),
    LLM_MODE: 'demo',
    CORS_ORIGIN: process.env.JASNO_E2E_WEB_URL,
    STORAGE_DIR: resolve(API_DIR, 'storage-e2e'),
  },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
