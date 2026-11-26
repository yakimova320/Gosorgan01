import { expect } from '@playwright/test';
import { test } from './fixtures';
import { API_URL, ADDRESS, PASSWORD, createUser, letters, uniqueEmail, openArchive } from './helpers';

/*
 * L07 (#83): языки сайта RU / UA / DE. Настоящий API (demo).
 */

test('гость: переключатель в шапке, язык запоминается, «скоро» выбрать нельзя', async ({ page }) => {
  await page.goto('/');
  const sw = page.getByTestId('lang-switcher');
  await expect(sw).toHaveValue('ru');
  await expect(page.getByRole('heading', { name: 'Письмо из ведомства?' })).toBeVisible();
  await expect(sw.locator('option[value="tr"]')).toBeDisabled();
  await expect(sw.locator('option[value="ar"]')).toBeDisabled();

  await sw.selectOption('uk');
  await expect(page.getByRole('heading', { name: 'Лист від відомства?' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await page.reload();
  await expect(page.getByTestId('lang-switcher')).toHaveValue('uk');

  await page.getByTestId('lang-switcher').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Ein Brief vom Amt?' })).toBeVisible();
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();
  // ошибка проверки формы тоже на языке сайта
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page.getByText('Geben Sie Ihre E-Mail ein')).toBeVisible();
});

test('язык браузера: немецкий браузер открывает сайт на немецком', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'de-DE' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId('lang-switcher')).toHaveValue('de');
  await expect(page.getByRole('heading', { name: 'Ein Brief vom Amt?' })).toBeVisible();
  await context.close();
});

test('регистрация на украинском: язык сохраняется в кабинете, смена в профиле', async ({ page, request }) => {
  await page.goto('/');
  await page.getByTestId('lang-switcher').selectOption('uk');
  await page.goto('/register');
  const email = uniqueEmail('lang');
  await page.getByLabel("Ім'я").fill(`Anna${letters()}`);
  await page.getByLabel('Прізвище').fill('Muster');
  await page.getByLabel('Адреса проживання').fill(ADDRESS);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторіть пароль').fill(PASSWORD);
  await page.getByLabel(/Я погоджуюся з обробкою/).check();
  await page.getByRole('button', { name: 'Зареєструватися' }).click();
  await expect(page).toHaveURL(/\/app/);
  await openArchive(page); // E01: экран ключа архива
  await expect(page.getByRole('heading', { name: 'Тут поки тихо' })).toBeVisible();

  const token = await page.evaluate(() => localStorage.getItem('jasno.session'));
  const cab = await request.get(`${API_URL}/cabinet`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await cab.json()).language).toBe('uk');

  await page.goto('/app/profile');
  await page.locator('#p-lang').selectOption('de');
  await expect(page.getByRole('heading', { name: 'Profil' })).toBeVisible();
  const cab2 = await request.get(`${API_URL}/cabinet`, { headers: { Authorization: `Bearer ${token}` } });
  expect((await cab2.json()).language).toBe('de');
});

test('вход: язык кабинета главнее языка браузера', async ({ page, request }) => {
  const u = await createUser(request, 'langlogin', `Anna${letters()}`);
  await request.patch(`${API_URL}/cabinet`, {
    headers: { Authorization: `Bearer ${u.token}` },
    data: { language: 'de' },
  });
  await page.goto('/');
  await expect(page.getByTestId('lang-switcher')).toHaveValue('ru');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), u.token);
  await page.goto('/app');
  await openArchive(page, u.token); // E01: экран ключа архива (на немецком)
  await expect(page.getByTestId('lang-switcher').first()).toHaveValue('de');
  await expect(page.getByRole('heading', { name: 'Hier ist es noch ruhig' })).toBeVisible();
});

test('FAQ, блог и горячие темы на языке сайта', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'uk-UA' });
  const page = await context.newPage();
  await page.goto('/faq');
  await expect(page.getByText('Чи можна увійти через Google або Apple?')).toBeVisible();
  await page.goto('/blog');
  await expect(page.getByText('Поїздка в Україну: спершу попередьте Jobcenter').first()).toBeVisible();
  await page.getByTestId('lang-switcher').selectOption('de');
  await expect(page.getByText('Reise in die Ukraine: Sagen Sie zuerst dem Jobcenter Bescheid').first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Aus Bürgergeld wird Grundsicherungsgeld: Was ist neu?').first()).toBeVisible();
  await context.close();
});
