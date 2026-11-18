import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.e2e-spec.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    // B18: обычные e2e регистрируют много пользователей с одного IP. Лимиты по IP и лимит операций
    // с моделью включают сами тесты лимитов (малые значения в своём createApp).
    env: { RATE_LIMIT_IP: 'false', LLM_DAILY_OPS_PER_CABINET: '1000' },
  },
});
