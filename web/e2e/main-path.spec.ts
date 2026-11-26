import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { API_URL, clientNavigate, fillRegistration, letters, uniqueEmail, openArchive } from './helpers';

/*
 * Весь основной путь на сайте с настоящим API: вход → письмо → факты → дело → объяснение →
 * черновик → «Скопировать». В CI модель demo; pnpm e2e:live запускает этот же сценарий
 * с настоящей моделью (вручную, отдельная тестовая схема и хранилище).
 */

const LIVE = process.env.JASNO_E2E_LIVE === '1';
/**
 * Live: ждать шага и сразу остановиться с понятной причиной, если провайдер модели перегружен.
 * В demo — обычное ожидание.
 */
async function step(page: Page, waitFor: () => Promise<unknown>) {
  if (!LIVE) return waitFor();
  const busy = page
    .getByText(/перегружен/i)
    .first()
    .waitFor({ state: 'visible', timeout: 300_000 })
    .then(() => 'busy' as const, () => 'done' as const);
  const result = await Promise.race([waitFor().then(() => 'done' as const), busy]);
  if (result === 'busy')
    throw new Error(
      'Провайдер модели перегружен (LLM_QUOTA). Это не ошибка кода: повторите позже или с другой моделью, ' +
        'например LLM_MODEL=gemini-3.5-flash-lite pnpm --filter jasno-web e2e:live',
    );
}

const fixture = resolve(
  import.meta.dirname,
  '..',
  '..',
  'fixtures',
  'letters',
  '01_jobcenter_request.pdf',
);

test('основной путь: от регистрации до скопированного немецкого текста', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(LIVE ? 300_000 : 90_000);
  const wait = LIVE ? 120_000 : 30_000;
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const health = (await (await request.get(`${API_URL}/health`)).json()) as {
    llmMode: string;
  };
  // live: настоящая модель, иначе demo
  expect(health.llmMode === 'demo').toBe(!LIVE);
  if (LIVE)
    console.log(`e2e:live: llmMode=${health.llmMode}${process.env.LLM_MODEL ? `, LLM_MODEL=${process.env.LLM_MODEL}` : ''}`);

  // 1. Регистрация
  await page.goto('/register');
  await fillRegistration(page, {
    email: uniqueEmail('main'),
    firstName: `Anna${letters()}`,
    lastName: 'Muster',
  });
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
  // E01: до первой загрузки — ключ архива и секрет восстановления
  await openArchive(page);

  // 2. Письмо (синтетическое 01). K11: при регистрации согласие на анализ ИИ не дано — спросят здесь
  await page.getByRole('link', { name: 'Сфотографировать письмо' }).click();
  await expect(page.getByTestId('ai-consent')).toBeVisible();
  await page.getByRole('checkbox', { name: /внешней модели ИИ/ }).check();
  await page.getByRole('button', { name: 'Дать согласие' }).click();
  await expect(page.getByTestId('ai-consent')).toHaveCount(0);
  await page.getByTestId('file-input').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Готово, читать письмо' }).click();
  await step(page, () => expect(page).toHaveURL(/\/check$/, { timeout: wait }));

  // 3. Факты: всё «Верно», одно сохранение
  await expect(page.getByTestId('claim').first()).toBeVisible();
  for (const b of await page
    .getByRole('button', { name: 'Верно', exact: true })
    .all())
    await b.click();
  await page.getByRole('button', { name: /Сохранить проверку/ }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Проверка сохранена' }),
  ).toBeVisible();

  // 4. В новое дело
  await page.getByRole('radio', { name: 'Новое дело' }).check();
  await page.getByRole('button', { name: 'В дело', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);

  // 5. Дело и объяснение
  await page.getByTestId('case-row').first().click();
  await expect(page.getByTestId('case-letter')).toHaveCount(1);
  const caseUrl = page.url();
  await page.getByRole('link', { name: 'Объяснение' }).click();
  await step(page, () => expect(page.getByTestId('explanation')).toBeVisible({ timeout: wait }));

  // 6. Черновик
  await page.goto(caseUrl);
  await page.getByRole('link', { name: /Подготовить ответ/ }).click();
  await page.getByRole('button', { name: /Задать вопрос ведомству/ }).click();
  await page.getByTestId('question').first().locator('input').check();
  await page.getByRole('button', { name: 'Собрать черновик' }).click();
  await expect(page).toHaveURL(/\/answer\/draft\?/, { timeout: 30_000 });
  const german = (await page.getByTestId('german-text').textContent())!;
  expect(german).toContain('Sehr geehrte Damen und Herren');
  expect(german).toContain('Mit freundlichen Grüßen');

  // 7. Скопировать: в буфере ровно немецкий текст
  await page
    .getByRole('button', { name: 'Скопировать немецкий текст' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Скопировано' }),
  ).toBeVisible();
  // буфер обмена Windows хранит переводы строк как \r\n: сравниваем текст, не вид переводов строк
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(
    german,
  );

  // 8. После перезагрузки черновик на месте
  await page.reload();
  await expect(page.getByTestId('german-text')).toHaveText(german);
  void clientNavigate;
});
