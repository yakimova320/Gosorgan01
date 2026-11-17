import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

/*
 * Браузерные тесты (TechBriefing v5, раздел 6): настоящий API на PostgreSQL в своей схеме,
 * модель в режиме demo, сайт в режиме api. Локальные .env не читаются.
 * Конфиг читается и в процессах-исполнителях, поэтому имя схемы задаётся один раз через env.
 */
process.env.JASNO_E2E_SCHEMA ??= `e2e_${Date.now()}_${randomBytes(4).toString('hex')}`;
const API_PORT = process.env.JASNO_E2E_API_PORT ?? '3100';
const WEB_PORT = process.env.JASNO_E2E_WEB_PORT ?? '5174';
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
process.env.JASNO_E2E_API_PORT = API_PORT;
process.env.JASNO_E2E_WEB_URL = WEB_URL;
process.env.JASNO_E2E_API_URL = `http://127.0.0.1:${API_PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  globalTeardown: './e2e/global-teardown.mjs',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter jasno-api build && node e2e/start-api.mjs',
      url: `http://127.0.0.1:${API_PORT}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'ignore',
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        VITE_DATA_MODE: 'api',
        VITE_API_URL: `http://127.0.0.1:${API_PORT}`,
      },
    },
  ],
});
