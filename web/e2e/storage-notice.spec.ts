import { expect, test } from '@playwright/test';

/*
 * K10 (#135): подсказка о хранении в браузере. Видна при каждом запуске сайта; «Понятно» скрывает до перезагрузки и ничего не сохраняет (поправка 1, 23.11).
 */

test('подсказка о хранении: видна при запуске, ссылка на Datenschutz, после перезагрузки снова видна', async ({ page }) => {
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
  // переход внутри сайта (без перезагрузки): подсказка остаётся скрытой
  await page.getByRole('contentinfo').getByRole('link', { name: 'Частые вопросы' }).click();
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.getByTestId('storage-notice')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('storage-notice')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage))).not.toContain('jasno.storageNotice');
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

test('поправки 2–5: Impressum в подвале, раздел «Блог», заготовки тем о детях', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Impressum' }).click();
  await expect(page).toHaveURL(/\/impressum$/);
  await expect(page.getByText('Angaben gemäß § 5 DDG')).toBeVisible();
  await page.goto('/blog?topic=children');
  await expect(page.getByRole('heading', { name: 'Блог', level: 1 })).toBeVisible();
  await expect(page.getByTestId('card-draft').first()).toContainText('Раздел готовится');
  await page.goto('/wissen');
  await expect(page.getByRole('heading', { name: 'Блог', level: 1 })).toBeVisible();
});
