import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { test } from './fixtures';
import { API_URL, PASSWORD, createUser, letters, loginUi, openArchive } from './helpers';

/*
 * A02: смена пароля на сайте с настоящим API (demo).
 * Два устройства = два независимых browser context со своими сессиями.
 */

const NEW_PASSWORD = 'e2e-neues-passwort-2';

/** Отдельный «браузер» (context) с собственной сессией, открыт профиль. */
async function device(browser: Browser, token: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
  await page.goto('/app/profile');
  await openArchive(page, token); // E01: экран ключа архива на каждом «устройстве»
  await expect(page.getByLabel('Старый пароль')).toBeVisible();
  return page;
}

async function apiLogin(request: APIRequestContext, email: string, password: string) {
  return request.post(`${API_URL}/auth/login`, { data: { email, password } });
}

async function fillChange(page: Page, oldPassword: string, newPassword: string) {
  await page.getByLabel('Старый пароль').fill(oldPassword);
  await page.getByLabel('Новый пароль', { exact: true }).fill(newPassword);
  await page.getByLabel('Повторите новый пароль').fill(newPassword);
}

test('неверный старый пароль: ошибка у поля без выхода; смена: этот браузер остаётся, второй просит войти', async ({
  browser,
  request,
}) => {
  const u = await createUser(request, 'pw', `Anna${letters()}`);
  const second = (await (await apiLogin(request, u.email, PASSWORD)).json())
    .sessionToken as string;
  const phone = await device(browser, u.token);
  const laptop = await device(browser, second);

  // повтор ещё не тронут: ошибки у него нет, кнопка не сдвигается под пальцем
  await phone.getByLabel('Старый пароль').fill('falsches-Passwort-1');
  await phone.getByLabel('Новый пароль', { exact: true }).fill(NEW_PASSWORD);
  await expect(phone.getByLabel('Повторите новый пароль')).not.toHaveAttribute('aria-invalid', 'true');
  await expect(phone.getByText('Повторите пароль')).toHaveCount(0);
  await phone.getByLabel('Повторите новый пароль').fill(NEW_PASSWORD);
  await phone.getByRole('button', { name: 'Сменить пароль' }).click();
  const old = phone.getByLabel('Старый пароль');
  await expect(phone.getByText('Неверный пароль')).toBeVisible();
  await expect(old).toHaveAttribute('aria-invalid', 'true');
  await expect(phone).toHaveURL(/\/app\/profile$/);
  expect(await phone.evaluate(() => localStorage.getItem('jasno.session'))).toBe(u.token);

  let posts = 0;
  phone.on(
    'request',
    (r) => r.method() === 'POST' && r.url() === `${API_URL}/auth/password/change` && posts++,
  );
  await fillChange(phone, PASSWORD, NEW_PASSWORD);
  await phone.getByRole('button', { name: 'Сменить пароль' }).dblclick();
  await expect(
    phone.getByRole('status').filter({ hasText: 'Пароль изменён' }),
  ).toBeVisible();
  expect(posts).toBe(1);
  await expect(old).toHaveValue('');

  // этот браузер остаётся в аккаунте после перезагрузки
  await phone.reload();
  await expect(phone).toHaveURL(/\/app\/profile$/);
  await expect(phone.getByLabel('E-mail')).toHaveValue(u.email);

  // второй браузер: после обновления просит войти; старый пароль не подходит, новый подходит
  await laptop.reload();
  await expect(laptop).toHaveURL(/\/login/);
  await loginUi(laptop, u.email, PASSWORD);
  await expect(laptop.getByText('Неверный e-mail или пароль')).toBeVisible();
  await loginUi(laptop, u.email, NEW_PASSWORD);
  await expect(laptop).toHaveURL(/\/app/);
  await expect(laptop).not.toHaveURL(/\/login/);
});

test('две одновременные смены из двух браузеров: применяется только одна', async ({
  browser,
  request,
}) => {
  const u = await createUser(request, 'pw2', `Bruno${letters()}`);
  const second = (await (await apiLogin(request, u.email, PASSWORD)).json())
    .sessionToken as string;
  const a = await device(browser, u.token);
  const b = await device(browser, second);
  await fillChange(a, PASSWORD, 'erstes-neues-Passwort');
  await fillChange(b, PASSWORD, 'zweites-neues-Passwort');

  const statuses: number[] = [];
  for (const p of [a, b])
    p.on('response', (r) => {
      if (r.url() === `${API_URL}/auth/password/change`) statuses.push(r.status());
    });
  await Promise.all([
    a.getByRole('button', { name: 'Сменить пароль' }).click(),
    b.getByRole('button', { name: 'Сменить пароль' }).click(),
  ]);
  await expect.poll(() => statuses.length).toBe(2);
  expect(statuses.sort()).toEqual([204, 401]);

  const okA = (await apiLogin(request, u.email, 'erstes-neues-Passwort')).status();
  const okB = (await apiLogin(request, u.email, 'zweites-neues-Passwort')).status();
  expect([okA, okB].sort()).toEqual([200, 401]);
  // проигравший браузер завершил сессию и просит войти, победивший показывает успех
  const [winner, loser] = okA === 200 ? [a, b] : [b, a];
  await expect(
    winner.getByRole('status').filter({ hasText: 'Пароль изменён' }),
  ).toBeVisible();
  await expect(loser).toHaveURL(/\/login/);
});
