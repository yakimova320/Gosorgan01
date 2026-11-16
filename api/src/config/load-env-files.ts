import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Загружает api/.env, затем .env в корне репозитория (там сейчас лежит ключ модели).
 * Уже заданные переменные не перезаписываются, поэтому api/.env главнее.
 */
export function loadEnvFiles(apiDir: string): string[] {
  const loaded: string[] = [];
  for (const file of [resolve(apiDir, '.env'), resolve(apiDir, '..', '.env')]) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      loaded.push(file);
    }
  }
  return loaded;
}
