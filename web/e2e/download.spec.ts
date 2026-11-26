import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { test } from './fixtures';
import { API_URL, createUser, letters, signedIn } from './helpers';

/*
 * E02 (#165): «Скачать оригинал». В хранилище оригинал зашифрован (JXB1); браузер расшифровывает
 * и отдаёт файл: PDF байт в байт, фото страниц одним PDF. Кнопка есть на странице письма и на проверке фактов.
 */

const fixture = (name: string) => resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name);

async function upload(request: APIRequestContext, token: string, name: string) {
  const res = await request.post(`${API_URL}/letters`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { files: { name, mimeType: 'application/pdf', buffer: readFileSync(fixture(name)) } },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { letter: { id: string } }).letter.id;
}

async function downloaded(page: Page) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-original').click()]);
  return { name: file.suggestedFilename(), bytes: readFileSync((await file.path())!) };
}

test('PDF: скачанный оригинал совпадает с загруженным байт в байт', async ({ page, request }) => {
  const u = await createUser(request, 'download-pdf', `Anna${letters()}`);
  const id = await upload(request, u.token, '01_jobcenter_request.pdf');
  await signedIn(page, u.token);

  // в хранилище не PDF: шифротекст JXB1
  const stored = await request.get(`${API_URL}/letters/${id}/file?page=1`, {
    headers: { Authorization: `Bearer ${u.token}` },
  });
  expect((await stored.body()).subarray(0, 4).toString('latin1')).toBe('JXB1');

  // JASNO_SHOTS=1: скриншоты 390 и 1440 px страницы письма с кнопкой
  if (process.env.JASNO_SHOTS) {
    const dir = resolve(import.meta.dirname, '..', '..', 'docs', 'screenshots', 'e02');
    mkdirSync(dir, { recursive: true });
    await page.goto(`/app/letters/${id}`);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.getByTestId('download-original').scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(dir, `letter-download-${width}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  for (const path of [`/app/letters/${id}`, `/app/letters/${id}/check`]) {
    await page.goto(path);
    await expect(page.getByTestId('download-original')).toBeVisible();
    await expect(page.getByTestId('letter-originals')).toContainText('Точная копия загруженного файла');
    const file = await downloaded(page);
    expect(file.name).toMatch(/^Jasno_\d{4}-\d{2}-\d{2}_.+\.pdf$/);
    expect(file.bytes.equals(readFileSync(fixture('01_jobcenter_request.pdf')))).toBe(true);
  }
});

test('фото страниц: один PDF, по странице на фото', async ({ page, request }) => {
  const u = await createUser(request, 'download-photo', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/scan');
  await page.getByTestId('file-input').setInputFiles([fixture('08_photo.jpg'), fixture('10_medium_scan.png')]);
  await page.getByRole('button', { name: 'Готово, читать письмо' }).click();
  await expect(page).toHaveURL(/\/app\/letters\/[^/]+\/check$/, { timeout: 30_000 });

  await expect(page.getByTestId('letter-originals')).toContainText('Фото страниц одним PDF');
  const file = await downloaded(page);
  expect(file.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  // две страницы: по одной на фото
  expect((await PDFDocument.load(file.bytes)).getPageCount()).toBe(2);
  // снимок JPEG встроен без пересжатия
  expect(file.bytes.includes(readFileSync(fixture('08_photo.jpg')))).toBe(true);
});
