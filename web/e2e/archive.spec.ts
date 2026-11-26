import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { test } from './fixtures';
import { API_URL, createUser, letters, signedIn } from './helpers';

/* L05 (#81): вопрос к своим письмам (demo: поиск по общим словам), справочник терминов. */

const fixture = (name: string) => resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name);


async function upload(request: APIRequestContext, token: string, name: string) {
  const res = await request.post(`${API_URL}/letters`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { files: { name, mimeType: 'application/pdf', buffer: readFileSync(fixture(name)) } },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { letter: { id: string } }).letter.id;
}

for (const width of [390, 1440]) {
  test(`${width} px: вопрос к своим письмам — ответ, цитата, переход к письму`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const u = await createUser(request, `archive-${width}`, `Anna${letters()}`);
    const letterId = await upload(request, u.token, '01_jobcenter_request.pdf');
    await upload(request, u.token, '04_buergeramt.pdf');
    await signedIn(page, u.token);

    await page.goto('/app/ask');
    await page.getByTestId('ask-letters-tab').click();
    await expect(page).toHaveURL(/\/app\/ask\/letters$/);

    const box = page.getByLabel('Вопрос о ваших письмах');
    await box.fill('Welche Kontoauszüge soll ich einreichen?');
    await box.press('Enter');

    await expect(page.getByTestId('archive-log')).toContainText('Welche Kontoauszüge soll ich einreichen?');
    const answer = page.getByTestId('archive-answer');
    await expect(answer).toContainText('Kontoauszüge');
    const source = answer.getByTestId('archive-sources');
    await expect(source).toContainText('«Bitte reichen Sie die Kontoauszüge für September ein.»');
    await expect(answer).toContainText('не юридическая консультация');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/l05-archive-${width}.png`, fullPage: true });

    await source.getByRole('link').first().click();
    await expect(page).toHaveURL(new RegExp(`/app/letters/${letterId}$`));
  });
}

test('без писем: честный ответ, без источников', async ({ page, request }) => {
  const u = await createUser(request, 'archive-empty', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/ask/letters');
  await page.getByRole('button', { name: 'Что от меня хочет Jobcenter?' }).click();
  await expect(page.getByTestId('archive-answer')).toContainText('пока нет писем');
  await expect(page.getByTestId('archive-sources')).toHaveCount(0);
});

test('справочник терминов: поиск, черновики в разработке помечены, ссылка в подвале', async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/faq');
    await page.getByTestId('site-footer').getByRole('link', { name: 'Глоссарий' }).click();
    await expect(page).toHaveURL(/\/glossary$/);
    await expect(page.getByRole('heading', { name: 'Справочник терминов' })).toBeVisible();
    await expect(page.getByTestId('glossary')).toContainText('Widerspruch');
    // vite dev: черновики видны с пометкой (на опубликованном сайте их нет)
    await expect(page.getByTestId('glossary-draft').first()).toHaveText('черновик, не проверено');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/l05-glossary-${width}.png`, fullPage: true });
  }
  await page.getByLabel('Поиск по терминам').fill('Aktenzeichen');
  await expect(page.getByTestId('glossary').locator('dt')).toHaveCount(1);
});
