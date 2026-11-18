import { expect, test, type Page } from '@playwright/test';
import { API_URL, PASSWORD, createUser, letters } from './helpers';

/*
 * A01: удаление аккаунта на сайте с настоящим API (demo).
 * Ответ 202 подменяется только для проверки интерфейса.
 */

async function signedIn(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
}

async function openDeleteForm(page: Page) {
  await page.goto('/app/profile');
  await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
}

test('неверный пароль: ошибка у поля, сессия остаётся; верный: одно удаление, выход и сообщение', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'del', `Anna${letters()}`);
  await signedIn(page, u.token);
  await openDeleteForm(page);

  const field = page.getByLabel('Введите пароль для подтверждения');
  await field.fill('falsches-Passwort-1');
  await page.getByRole('button', { name: 'Удалить навсегда' }).click();
  await expect(page.getByText('Неверный пароль')).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/app\/profile$/);
  expect(await page.evaluate(() => localStorage.getItem('jasno.session'))).toBe(
    u.token,
  );
  // сессия жива
  expect(
    (
      await request.get(`${API_URL}/cabinet`, {
        headers: { Authorization: `Bearer ${u.token}` },
      })
    ).status(),
  ).toBe(200);

  let deletes = 0;
  page.on(
    'request',
    (r) =>
      r.method() === 'DELETE' && r.url() === `${API_URL}/cabinet` && deletes++,
  );
  await field.fill(PASSWORD);
  await page.getByRole('button', { name: 'Удалить навсегда' }).dblclick();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId('account-deleted')).toHaveText(
    'Аккаунт и все данные удалены',
  );
  expect(deletes).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem('jasno.session')),
  ).toBeNull();

  // аккаунта нет: ни сессии, ни входа
  expect(
    (
      await request.get(`${API_URL}/cabinet`, {
        headers: { Authorization: `Bearer ${u.token}` },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post(`${API_URL}/auth/login`, {
        data: { email: u.email, password: PASSWORD },
      })
    ).status(),
  ).toBe(401);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login/);
});

test('202 DELETION_PENDING: выход, кэш очищен, сообщение «продолжается»', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'pend', `Bruno${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/profile');
  await expect(page.getByLabel('E-mail')).toHaveValue(u.email);
  await page.route(`${API_URL}/cabinet`, (r) =>
    r.request().method() === 'DELETE'
      ? r.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'DELETION_PENDING',
            message:
              'Удаление аккаунта продолжается. Повторять запрос не нужно',
          }),
        })
      : r.continue(),
  );
  await page.getByRole('button', { name: 'Удалить аккаунт' }).click();
  await page.getByLabel('Введите пароль для подтверждения').fill(PASSWORD);
  await page.getByRole('button', { name: 'Удалить навсегда' }).click();
  await expect(page.getByTestId('account-deleted')).toHaveText(
    'Удаление аккаунта продолжается. Повторять запрос не нужно',
  );
  expect(
    await page.evaluate(() => localStorage.getItem('jasno.session')),
  ).toBeNull();
  // кэш RTK Query сброшен: данных прошлого кабинета на странице нет
  await expect(page.getByText(u.email)).toHaveCount(0);
});
