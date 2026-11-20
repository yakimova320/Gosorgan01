import { expect, test } from '@playwright/test';

/*
 * K10 (#135): подсказка о хранении в браузере. Видна при первом визите, после «Понятно» не возвращается.
 */

test('подсказка о хранении: первый визит, ссылка на Datenschutz, «Понятно» запоминается', async ({ page }) => {
  await page.goto('/');
  const notice = page.getByTestId('storage-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('не использует рекламу, аналитику и трекинг');
  await expect(notice.locator('[lang="de"]')).toContainText('technisch notwendige');

  await notice.getByRole('link', { name: 'Datenschutz' }).click();
  await expect(page).toHaveURL(/\/datenschutz#cookies$/);
  await expect(page.getByRole('heading', { name: /Cookies и хранение/ })).toBeVisible();

  await page.getByRole('button', { name: 'Понятно' }).click();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('storage-notice')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(['jasno.storageNotice']);
});

test('390 px: подсказка не перекрывает кнопки и не даёт горизонтальной прокрутки', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const notice = page.getByTestId('storage-notice');
  await expect(notice).toBeVisible();
  const button = notice.getByRole('button', { name: 'Понятно' });
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(notice).toHaveCount(0);
});
