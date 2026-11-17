import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  clientNavigate,
  createUser,
  loginUi,
  PASSWORD,
  uniqueEmail,
} from './helpers';

const FIXTURE_PDF = resolve(
  import.meta.dirname,
  '..',
  '..',
  'fixtures',
  'letters',
  '01_jobcenter_request.pdf',
);

test('регистрация через сайт ведёт в кабинет, выход возвращает на главную', async ({
  page,
}) => {
  await page.goto('/register');
  await page.getByLabel('E-mail').fill(uniqueEmail('reg'));
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
  await clientNavigate(page, '/app/profile');
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
});

test('пользователь Б в том же браузере не видит данных пользователя А', async ({
  page,
  request,
}) => {
  const a = await createUser(request, 'a', `Annika${Date.now() % 100000}`);
  const b = await createUser(request, 'b', `Bruno${Date.now() % 100000}`);

  await page.goto('/login');
  await loginUi(page, a.email);
  await expect(
    page.getByRole('heading', { name: new RegExp(a.firstName) }),
  ).toBeVisible();
  await clientNavigate(page, '/app/profile');
  await expect(page.locator('#p-email')).toHaveValue(a.email);

  // Выход и вход Б без перезагрузки страницы: проверяется именно кэш в памяти.
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/$/);
  await clientNavigate(page, '/login');
  await loginUi(page, b.email);
  await expect(
    page.getByRole('heading', { name: new RegExp(b.firstName) }),
  ).toBeVisible();
  await expect(page.getByText(a.firstName)).toHaveCount(0);
  await clientNavigate(page, '/app/profile');
  await expect(page.locator('#p-email')).toHaveValue(b.email);
  await expect(page.getByText(a.email)).toHaveCount(0);

  // Сессия восстанавливается после перезагрузки.
  await page.reload();
  await expect(page).toHaveURL(/\/app\/profile$/);
  await expect(page.locator('#p-email')).toHaveValue(b.email);
});

test('выбранные файлы сценария не переходят к другому пользователю', async ({
  page,
  request,
}) => {
  const a = await createUser(request, 'fa', 'Filea');
  const b = await createUser(request, 'fb', 'Fileb');
  await page.goto('/login');
  await loginUi(page, a.email);
  await expect(page).toHaveURL(/\/app$/);
  await clientNavigate(page, '/app/scan');
  await page.locator('input[type="file"][multiple]').setInputFiles(FIXTURE_PDF);
  await expect(page).toHaveURL(/\/app\/scan\/pages$/);

  await clientNavigate(page, '/app/profile');
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/$/);
  await clientNavigate(page, '/login');
  await loginUi(page, b.email);
  await expect(page).toHaveURL(/\/app$/);
  await clientNavigate(page, '/app/scan/pages');
  await expect(page).toHaveURL(/\/app\/scan$/);
});

test('испорченный токен ведёт на вход с пояснением', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem('jasno.session', 'not-a-real-token'),
  );
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Сессия истекла. Войдите снова.')).toBeVisible();
});

test('неверный пароль показывает ошибку и не выглядит как истёкшая сессия', async ({
  page,
  request,
}) => {
  const a = await createUser(request, 'wrong', 'Wrong');
  await page.goto('/login');
  await loginUi(page, a.email, 'falsches-passwort-123');
  await expect(page.getByText('Неверный e-mail или пароль')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Сессия истекла')).toHaveCount(0);
});
