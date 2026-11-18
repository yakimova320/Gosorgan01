import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_URL, createUser, letters } from './helpers';

/*
 * B18: что видит человек при лимитах. Сами лимиты проверяет e2e API (малые значения);
 * здесь ответы сервера подменяются только для проверки интерфейса.
 */

const fixture = (name: string) =>
  resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name);

const DAILY = {
  code: 'RATE_LIMITED',
  message: 'Лимит: не больше 30 писем и объяснений за 24 часа. Следующее будет доступно через 3 ч 20 мин',
  details: { reason: 'LLM_DAILY_OPS', limit: 30, retryAfterSec: 12000 },
};
const QUOTA = { code: 'LLM_QUOTA', message: 'Ja!sno сейчас перегружен. Попробуйте позже' };

async function signedIn(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
}

async function startUpload(page: Page) {
  await page.goto('/app/scan');
  await page.getByTestId('file-input').setInputFiles(fixture('01_jobcenter_request.pdf'));
  await page.getByRole('button', { name: 'Готово, читать письмо' }).click();
}

test('загрузка: дневной лимит — текст со временем ожидания, без кнопки повтора; перегрузка — текст и повтор', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'lim', `Anna${letters()}`);
  await signedIn(page, u.token);
  let posts = 0;
  await page.route(`${API_URL}/letters`, (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    posts++;
    return r.fulfill({
      status: 429,
      headers: { 'Retry-After': '12000' },
      contentType: 'application/json',
      body: JSON.stringify(DAILY),
    });
  });
  await startUpload(page);
  await expect(page.getByTestId('upload-busy')).toContainText(
    'Следующее будет доступно через 3 ч 20 мин. Письмо не сохранено.',
  );
  await expect(page.getByRole('button', { name: 'Попробовать ещё раз' })).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(posts).toBe(1);

  await page.unroute(`${API_URL}/letters`);
  await page.route(`${API_URL}/letters`, (r) =>
    r.request().method() === 'POST'
      ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(QUOTA) })
      : r.continue(),
  );
  await startUpload(page);
  await expect(page.getByTestId('upload-busy')).toContainText('Ja!sno сейчас перегружен. Попробуйте позже');
  await expect(page.getByRole('button', { name: 'Попробовать ещё раз' })).toBeVisible();
  // без тихой подмены demo-ответом: письма нет
  await expect(page.getByTestId('claim')).toHaveCount(0);
});

test('объяснение: дневной лимит — текст сервера, повтор недоступен; объяснения-заглушки нет', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'limx', `Bruno${letters()}`);
  const h = { Authorization: `Bearer ${u.token}` };
  const up = await (
    await request.post(`${API_URL}/letters`, {
      headers: h,
      multipart: {
        files: {
          name: 'a.pdf',
          mimeType: 'application/pdf',
          buffer: readFileSync(fixture('01_jobcenter_request.pdf')),
        },
      },
    })
  ).json();
  await request.post(`${API_URL}/letters/${up.letter.id}/claims/confirm`, {
    headers: h,
    data: { confirm: (up.claims as { id: string }[]).map((c) => c.id) },
  });
  await signedIn(page, u.token);
  await page.route(`${API_URL}/letters/${up.letter.id}/explain?lang=ru`, (r) =>
    r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify(DAILY) }),
  );
  await page.goto(`/app/letters/${up.letter.id}`);
  await expect(page.getByRole('alert')).toContainText('Следующее будет доступно через 3 ч 20 мин');
  await expect(page.getByTestId('explanation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Попробовать ещё раз' })).toBeDisabled();
});
