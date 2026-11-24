import { expect, test, type Page } from '@playwright/test';
import { API_URL, createUser, letters } from './helpers';

/*
 * K12: профиль, блок «Календарь и напоминания». Настоящий API (demo).
 * Ссылка создаётся, лента открывается, новая ссылка заменяет старую, письма можно выключить.
 */

async function signedIn(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
}

test('календарь: создать ссылку, лента .ics, новая ссылка, выключить письма', async ({ page, request }) => {
  const u = await createUser(request, 'calendar', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/profile');

  const block = page.getByTestId('calendar-profile');
  await expect(block.getByRole('heading', { name: 'Календарь и напоминания' })).toBeVisible();
  await block.getByRole('button', { name: 'Создать ссылку для календаря' }).click();

  const field = block.getByLabel('Ваша ссылка на календарь');
  await expect(field).toHaveValue(new RegExp(`^${API_URL}/calendar/[A-Za-z0-9_-]{43}\\.ics$`));
  const first = await field.inputValue();
  await expect(block.getByRole('link', { name: 'Добавить в Google Календарь' })).toHaveAttribute(
    'href',
    `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(first.replace(/^http:\/\//, 'webcal://'))}`,
  );
  await expect(block.getByRole('link', { name: 'Календарь iPhone или Mac' })).toHaveAttribute(
    'href',
    first.replace(/^http:\/\//, 'webcal://'),
  );

  const feed = await request.get(first);
  expect(feed.status()).toBe(200);
  expect(feed.headers()['content-type']).toBe('text/calendar; charset=utf-8');
  expect(await feed.text()).toContain('BEGIN:VCALENDAR');

  await block.getByRole('button', { name: 'Новая ссылка' }).click();
  await expect(block.getByRole('status')).toContainText('Старая ссылка перестанет работать');
  await block.getByRole('button', { name: 'Создать новую ссылку' }).click();
  await expect(field).not.toHaveValue(first);
  expect((await request.get(first)).status()).toBe(404);

  const reminder = block.getByLabel('Напоминать письмом за 3 дня до срока');
  await expect(reminder).toBeChecked();
  await reminder.uncheck();
  await expect(reminder).not.toBeChecked();
  await page.reload();
  await expect(page.getByTestId('calendar-profile').getByLabel('Напоминать письмом за 3 дня до срока')).not.toBeChecked();

  await page.getByTestId('calendar-profile').getByRole('button', { name: 'Отключить календарь' }).click();
  await expect(
    page.getByTestId('calendar-profile').getByRole('button', { name: 'Создать ссылку для календаря' }),
  ).toBeVisible();
});
