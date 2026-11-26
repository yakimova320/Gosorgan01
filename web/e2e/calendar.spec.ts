import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { API_URL, createUser, letters, signedIn } from './helpers';

/*
 * K12, поправка 26.11: блок «Календарь и напоминания» в кабинете. Настоящий API (demo).
 * Подписки .ics на сайте нет. Старую ссылку (создана раньше) можно отключить, письма за 3 дня — выключить.
 * Сроки с кнопкой «В Google Календарь» проверяет send.spec.ts.
 */


test('календарь: без сроков, отключить старую ссылку, выключить письма', async ({ page, request }) => {
  const u = await createUser(request, 'calendar', `Anna${letters()}`);
  const h = { Authorization: `Bearer ${u.token}` };
  // ссылка-подписка, созданная до поправки 26.11
  const created = await (await request.post(`${API_URL}/cabinet/calendar/token`, { headers: h })).json();
  expect(created.feedPath).toMatch(/^\/calendar\/[A-Za-z0-9_-]{43}\.ics$/);

  await signedIn(page, u.token);
  await page.goto('/app');
  const block = page.getByTestId('calendar-profile');
  await expect(block.getByRole('heading', { name: 'Календарь и напоминания' })).toBeVisible();
  await expect(block.getByText('Ближайших сроков пока нет.')).toBeVisible();
  await expect(block.getByRole('link', { name: 'Календарь iPhone или Mac' })).toHaveCount(0);
  await expect(block.getByLabel('Ваша ссылка на календарь')).toHaveCount(0);

  await block.getByRole('button', { name: 'Отключить старую ссылку' }).click();
  await expect(block.getByRole('button', { name: 'Отключить старую ссылку' })).toHaveCount(0);
  expect((await request.get(`${API_URL}${created.feedPath}`)).status()).toBe(404);

  const reminder = block.getByLabel('Напоминать письмом за 3 дня до срока');
  await expect(reminder).toBeChecked();
  await reminder.uncheck();
  await expect(reminder).not.toBeChecked();
  await page.reload();
  await expect(page.getByTestId('calendar-profile').getByLabel('Напоминать письмом за 3 дня до срока')).not.toBeChecked();
});
