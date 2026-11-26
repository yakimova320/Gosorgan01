import { test as base } from '@playwright/test';
import { withVaultKeys } from './vault-client';

/**
 * E01 (#163): request в тестах ведёт себя как браузер с открытым архивом (ключи документов, расшифровка).
 * Сайт в тех же тестах проходит экран ключа архива (helpers.signedIn).
 */
export const test = base.extend({
  request: async ({ request }, use) => {
    await use(withVaultKeys(request));
  },
});
