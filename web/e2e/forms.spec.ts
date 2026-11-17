import { expect, test } from '@playwright/test';
import { createUser, PASSWORD, uniqueEmail } from './helpers';

/* Поля и проверка форм (TechBriefing v5, раздел 5.3). */

test('ошибка e-mail после первого ухода из поля и исчезает после исправления', async ({
  page,
}) => {
  await page.goto('/register');
  const email = page.getByLabel('E-mail');
  await email.fill('anna@');
  await expect(page.getByText('Неверный e-mail')).toHaveCount(0); // пока поле в фокусе, ошибки нет
  await email.blur();
  await expect(page.getByText('Неверный e-mail')).toBeVisible();
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAttribute('aria-describedby', 'r-email-error');
  await email.fill('anna@example.org'); // после первого ухода проверка идёт при каждом изменении
  await expect(page.getByText('Неверный e-mail')).toHaveCount(0);
  await expect(email).not.toHaveAttribute('aria-invalid', 'true');
});

test('короткий пароль и несовпадение повтора показываются у своих полей', async ({
  page,
}) => {
  await page.goto('/register');
  const pw = page.getByLabel('Пароль', { exact: true });
  await pw.fill('kurz');
  await pw.blur();
  await expect(page.locator('#r-password-error')).toHaveText(
    'Пароль: не меньше 10 знаков',
  );
  await pw.fill(PASSWORD);
  const repeat = page.getByLabel('Повторите пароль');
  await repeat.fill(PASSWORD + 'x');
  await repeat.blur();
  await expect(page.locator('#r-password2-error')).toHaveText(
    'Пароли не совпадают',
  );
  await repeat.fill(PASSWORD);
  await expect(page.locator('#r-password2-error')).toHaveCount(0);
});

test('отправка пустой формы: ошибки видны, фокус на первом поле с ошибкой', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByLabel('E-mail')).toBeFocused();
  await expect(page.locator('#r-email-error')).toBeVisible();
  await expect(page.locator('#r-consent-error')).toHaveText(
    'Нужно согласие на обработку данных',
  );
});

test('без согласия форма не уходит на сервер', async ({ page }) => {
  let requests = 0;
  page.on('request', (r) => r.url().endsWith('/auth/register') && requests++);
  await page.goto('/register');
  await page.getByLabel('E-mail').fill(uniqueEmail('noconsent'));
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.getByRole('checkbox')).toBeFocused();
  await expect(page.locator('#r-consent-error')).toBeVisible();
  expect(requests).toBe(0);
});

test('повторное нажатие во время запроса не отправляет форму второй раз', async ({
  page,
}) => {
  let requests = 0;
  page.on('request', (r) => r.url().endsWith('/auth/register') && requests++);
  await page.goto('/register');
  await page.getByLabel('E-mail').fill(uniqueEmail('double'));
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  const button = page.locator('form button[type="submit"]');
  await button.click();
  await page.keyboard.press('Enter');
  await button.click({ force: true }).catch(() => undefined);
  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
  expect(requests).toBe(1);
});

test('EMAIL_TAKEN показывается у поля e-mail', async ({ page, request }) => {
  const a = await createUser(request, 'taken', 'Taken');
  await page.goto('/register');
  await page.getByLabel('E-mail').fill(a.email);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.locator('#r-email-error')).toHaveText(
    'Этот e-mail уже зарегистрирован',
  );
  await expect(page.getByLabel('E-mail')).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('пароль при входе не проверяется по правилам нового пароля', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(uniqueEmail('short'));
  await page.getByLabel('Пароль', { exact: true }).fill('kurz');
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.getByText('Неверный e-mail или пароль')).toBeVisible();
  await expect(page.getByText('не меньше 10 знаков')).toHaveCount(0);
});

test('неподключённая функция честно говорит об этом', async ({ page }) => {
  await page.goto('/forgot');
  await page.getByLabel('E-mail').fill('anna@example.org');
  await page.getByRole('button', { name: 'Отправить ссылку' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Эта функция ещё не подключена к серверу',
  );
});
