import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  API_URL,
  clientNavigate,
  fillRegistration,
  letters,
  uniqueEmail,
} from './helpers';

/*
 * Весь основной путь на сайте с настоящим API: вход → письмо → факты → дело → объяснение →
 * черновик → «Скопировать». В CI модель demo; pnpm e2e:live запускает этот же сценарий
 * с настоящей моделью (вручную, отдельная тестовая схема и хранилище).
 */

const LIVE = process.env.JASNO_E2E_LIVE === '1';
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
  if (LIVE) console.log(`e2e:live: llmMode=${health.llmMode}`);

  // 1. Регистрация
  await page.goto('/register');
  await fillRegistration(page, {
    email: uniqueEmail('main'),
    firstName: `Anna${letters()}`,
    lastName: 'Muster',
  });
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });

  // 2. Письмо (синтетическое 01)
  await page.getByRole('link', { name: 'Сфотографировать письмо' }).click();
  await page.getByTestId('file-input').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Готово, читать письмо' }).click();
  await expect(page).toHaveURL(/\/check$/, { timeout: wait });

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
  await expect(page.getByTestId('explanation')).toBeVisible({ timeout: wait });

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
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    german,
  );

  // 8. После перезагрузки черновик на месте
  await page.reload();
  await expect(page.getByTestId('german-text')).toHaveText(german);
  void clientNavigate;
});
