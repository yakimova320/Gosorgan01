import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  API_URL,
  clientNavigate,
  fillRegistration,
  letters,
  loginUi,
  uniqueEmail,
} from './helpers';

/*
 * Приёмка регистрации с именем, фамилией и адресом:
 * два пользователя с разными именами, пустые кабинеты, сохранение и изменение профиля,
 * запрет кириллицы, первое письмо видно только владельцу.
 */

const FIXTURE_PDF = resolve(
  import.meta.dirname,
  '..',
  '..',
  'fixtures',
  'letters',
  '01_jobcenter_request.pdf',
);

async function register(page: Page, firstName: string, lastName: string) {
  const email = uniqueEmail('user');
  await page.goto('/register');
  await fillRegistration(page, {
    email,
    firstName,
    lastName,
    address: `${lastName}weg 5, 10115 Berlin`,
    aiConsent: true,
  });
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
  const token = await page.evaluate(() =>
    localStorage.getItem('jasno.session'),
  );
  return { email, firstName, lastName, token: token! };
}

async function logout(page: Page) {
  await clientNavigate(page, '/app/profile');
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/$/);
}

test('новый аккаунт: данные сохранены сервером, кабинет пустой с кнопкой загрузки', async ({
  page,
  request,
}) => {
  const a = await register(page, `Jürgen${letters()}`, 'O’Neill');
  await expect(
    page.getByRole('heading', { name: new RegExp(a.firstName) }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Здесь пока тихо' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Сфотографировать письмо' }),
  ).toBeVisible();

  const cabinet = await request.get(`${API_URL}/cabinet`, {
    headers: { Authorization: `Bearer ${a.token}` },
  });
  expect((await cabinet.json()).profile).toEqual({
    firstName: a.firstName,
    lastName: 'O’Neill',
    address: 'O’Neillweg 5, 10115 Berlin',
  });
  const inbox = await request.get(`${API_URL}/letters`, {
    headers: { Authorization: `Bearer ${a.token}` },
  });
  expect(await inbox.json()).toEqual([]);
});

test('кириллица в имени и фамилии: ошибка у поля, запрос не уходит', async ({
  page,
}) => {
  let requests = 0;
  page.on('request', (r) => r.url().endsWith('/auth/register') && requests++);
  await page.goto('/register');
  await fillRegistration(page, {
    email: uniqueEmail('cyr'),
    firstName: 'Анна',
    lastName: 'Иванова',
  });
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page.locator('#r-first-error')).toHaveText(
    'Введите имя латинскими буквами',
  );
  await expect(page.locator('#r-last-error')).toHaveText(
    'Введите фамилию латинскими буквами',
  );
  await expect(page.getByLabel('Имя', { exact: true })).toBeFocused();
  expect(requests).toBe(0);
});

test('профиль: изменение сохраняется, обязательное поле нельзя очистить', async ({
  page,
  request,
}) => {
  const a = await register(page, `Anna${letters()}`, 'Muster');
  await clientNavigate(page, '/app/profile');
  const last = page.getByLabel('Фамилия', { exact: true });
  await expect(last).toHaveValue('Muster');

  await last.fill('Müller-Lüdenscheidt');
  // поправка 6: адрес по частям
  await page.getByLabel('Улица и номер дома').fill('Neue Str. 2');
  await page.getByLabel('Индекс').fill('20095');
  await page.getByLabel('Город').fill('Hamburg');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Сохранено' }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Фамилия', { exact: true })).toHaveValue(
    'Müller-Lüdenscheidt',
  );
  await expect(page.getByLabel('Улица и номер дома')).toHaveValue('Neue Str. 2');
  await expect(page.getByLabel('Индекс')).toHaveValue('20095');
  await expect(page.getByLabel('Город')).toHaveValue('Hamburg');
  const saved = await request.get(`${API_URL}/cabinet`, {
    headers: { Authorization: `Bearer ${a.token}` },
  });
  expect((await saved.json()).profile.address).toBe('Neue Str. 2, 20095 Hamburg');
  await expect(page.getByLabel('Имя', { exact: true })).toHaveValue(
    a.firstName,
  );

  await page.getByLabel('Фамилия', { exact: true }).fill('Петрова');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('#p-last-error')).toHaveText(
    'Введите фамилию латинскими буквами',
  );
  await page.getByLabel('Фамилия', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('#p-last-error')).toHaveText(
    'Введите фамилию латинскими буквами',
  );

  // и на сервере: очистить нельзя
  const res = await request.patch(`${API_URL}/cabinet`, {
    headers: { Authorization: `Bearer ${a.token}` },
    data: { profile: { address: '' } },
  });
  expect(res.status()).toBe(400);
});

test('два пользователя: первое письмо видно только владельцу, у второго кабинет пустой', async ({
  page,
  request,
}) => {
  const a = await register(page, `Annika${letters()}`, 'Muster');
  // письмо загружается через API (экран загрузки на сайте — F02), затем страница обновляется
  const upload = await request.post(`${API_URL}/letters`, {
    headers: { Authorization: `Bearer ${a.token}` },
    multipart: {
      files: {
        name: 'brief.pdf',
        mimeType: 'application/pdf',
        buffer: readFileSync(FIXTURE_PDF),
      },
    },
  });
  expect(upload.status()).toBe(201);
  await page.reload();
  await expect(page.getByTestId('inbox-letter')).toHaveCount(1);
  await expect(page.getByTestId('inbox-letter')).toContainText(
    'Jobcenter Musterstadt',
  );

  await logout(page);
  await clientNavigate(page, '/register');
  const b = await register(page, `Bruno${letters()}`, 'Beispiel');
  await expect(
    page.getByRole('heading', { name: new RegExp(b.firstName) }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Здесь пока тихо' }),
  ).toBeVisible();
  await expect(page.getByText(a.firstName)).toHaveCount(0);
  await expect(page.getByTestId('inbox-letter')).toHaveCount(0);

  await logout(page);
  await clientNavigate(page, '/login');
  await loginUi(page, a.email);
  await expect(page.getByTestId('inbox-letter')).toHaveCount(1);
});
