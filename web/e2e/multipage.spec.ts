import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_URL, createUser, letters } from './helpers';

/* B11: письмо из нескольких фото, проверка снимков, PDF-скан, оригиналы только владельцу. Настоящий API (demo). */

const fixture = (name: string) => resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name);

async function signedIn(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
}

const pageCards = (page: Page) => page.getByTestId('scan-page');

test('несколько фото: нечитаемая страница → вернуться к снимкам, убрать, добавить, поменять порядок; оригиналы по порядку', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'multi', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/scan');
  await page.getByTestId('file-input').setInputFiles([fixture('08_photo.jpg'), fixture('11_bad_photo.jpg')]);
  await expect(page).toHaveURL(/\/app\/scan\/pages$/);
  await expect(pageCards(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Страница 1: выше' })).toBeDisabled();

  // страница 2 не читается: письмо не сохранено, снимки остались
  await page.getByRole('button', { name: 'Готово, читать письмо' }).click();
  await expect(page.getByRole('alert')).toContainText('Страница 2 не читается');
  await page.getByRole('button', { name: 'Вернуться к снимкам' }).click();
  await expect(pageCards(page)).toHaveCount(2);

  await page.getByRole('button', { name: 'Убрать страницу 2' }).click();
  await expect(pageCards(page)).toHaveCount(1);
  await page.getByTestId('file-input').setInputFiles(fixture('10_medium_scan.png'));
  await expect(pageCards(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Страница 2: выше' }).click();
  await expect(page.getByRole('img', { name: 'Страница 1' })).toBeVisible();

  await page.getByRole('button', { name: 'Готово, читать письмо' }).click();
  await expect(page).toHaveURL(/\/app\/letters\/[^/]+\/check$/);
  const letterId = /letters\/([^/]+)\/check/.exec(page.url())![1];

  // порядок страниц на сервере: 10 (png), затем 08 (jpg)
  const detail = await (
    await request.get(`${API_URL}/letters/${letterId}`, { headers: { Authorization: `Bearer ${u.token}` } })
  ).json();
  expect(detail.letter.files).toEqual([
    { n: 1, mime: 'image/png', bytes: statSync(fixture('10_medium_scan.png')).size },
    { n: 2, mime: 'image/jpeg', bytes: statSync(fixture('08_photo.jpg')).size },
  ]);

  // оригинал открывается в блоке на странице проверки
  await page.getByText('Оригинал письма (2 фото страниц)').click();
  for (const n of [1, 2]) {
    const img = page.getByRole('img', { name: `Оригинал, страница ${n}` });
    await expect(img).toBeVisible();
    expect(await img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }

  // чужой пользователь оригинал не получает
  const other = await createUser(request, 'multi-fremd', `Berta${letters()}`);
  const foreign = await request.get(`${API_URL}/letters/${letterId}/file?page=1`, {
    headers: { Authorization: `Bearer ${other.token}` },
  });
  expect(foreign.status()).toBe(404);
});

test('выбор: PDF вместе с фото не добавляется; больше 10 фото — лишние не добавлены', async ({ page, request }) => {
  const u = await createUser(request, 'pick', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/scan');
  await page.getByTestId('file-input').setInputFiles(fixture('08_photo.jpg'));
  await expect(pageCards(page)).toHaveCount(1);
  await page.getByTestId('file-input').setInputFiles([fixture('09_scan.png'), fixture('01_jobcenter_request.pdf')]);
  await expect(page.getByRole('alert')).toContainText('PDF загружается отдельно');
  await expect(pageCards(page)).toHaveCount(1);

  const eleven = Array.from({ length: 11 }, (_, i) => ({
    name: `p${i}.jpg`,
    mimeType: 'image/jpeg',
    buffer: Buffer.from([0xff, 0xd8, 0xff, i]),
  }));
  await page.getByTestId('file-input').setInputFiles(eleven);
  await expect(pageCards(page)).toHaveCount(10);
  await expect(page.getByRole('alert')).toContainText('не больше 10 фото');
  await expect(page.getByText('Это максимум: 10 фото на письмо.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Добавить фото' })).toHaveCount(0);
});

test('скан PDF: распознаётся, факты со скана, оригинал PDF открывается', async ({ page, request }) => {
  const u = await createUser(request, 'scan', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/scan');
  await page.getByTestId('file-input').setInputFiles(fixture('09_scan.pdf'));
  await expect(page.getByRole('heading', { name: 'Проверьте файл' })).toBeVisible();
  await page.getByRole('button', { name: 'Готово, читать письмо' }).click();
  await expect(page).toHaveURL(/\/app\/letters\/[^/]+\/check$/);
  await expect(page.getByTestId('claim').filter({ hasText: 'SA-2026-8810' })).toBeVisible();
  await page.getByText('Оригинал письма (PDF)').click();
  const link = page.getByRole('link', { name: 'Открыть PDF' });
  await expect(link).toHaveAttribute('href', /^blob:/);
});
