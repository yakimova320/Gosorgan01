import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { API_URL, PASSWORD, createUser, letters, loginUi, openArchive } from './helpers';

/*
 * A03: восстановление пароля на сайте с настоящим API (demo, MAIL_MODE=file).
 * Письмо лежит в api/storage-e2e/mail-outbox/<кабинет>/ (STORAGE_DIR тестового API).
 */

const OUTBOX = resolve(import.meta.dirname, '..', '..', 'api', 'storage-e2e', 'mail-outbox');
const NEW_PASSWORD = 'e2e-neues-passwort-3';

/** Путь ссылки из письма этому адресу (quoted-printable: мягкие переносы и =3D). */
async function linkFor(email: string): Promise<string> {
  let found = '';
  await expect
    .poll(
      () => {
        if (!existsSync(OUTBOX)) return '';
        for (const dir of readdirSync(OUTBOX))
          for (const file of readdirSync(join(OUTBOX, dir))) {
            const eml = readFileSync(join(OUTBOX, dir, file), 'utf8')
              .replace(/=\r?\n/g, '')
              .replace(/=3D/g, '=');
            if (!eml.includes(`To: ${email}`)) continue;
            const m = /(\/reset\?token=[A-Za-z0-9_-]+)/.exec(eml);
            if (m) found = m[1];
          }
        return found;
      },
      { timeout: 10_000 },
    )
    .not.toBe('');
  return found;
}

async function fillNew(page: Page, password: string) {
  await page.getByLabel('Новый пароль', { exact: true }).fill(password);
  await page.getByLabel('Повторите пароль').fill(password);
}

test('забыли пароль → письмо → новый пароль → вход; ссылка из адресной строки убрана; повтор ссылки — ошибка', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'fgt', `Anna${letters()}`);
  await page.goto('/login');
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');
  await page.getByRole('link', { name: 'Забыли пароль?' }).click();
  await expect(page).toHaveURL(/\/forgot$/);

  let posts = 0;
  page.on(
    'request',
    (r) => r.method() === 'POST' && r.url() === `${API_URL}/auth/password/forgot` && posts++,
  );
  await page.getByLabel('E-mail').fill(u.email);
  await page.getByRole('button', { name: 'Отправить ссылку' }).dblclick();
  await expect(page.getByRole('status')).toContainText('Если такой адрес есть, мы отправили письмо');
  expect(posts).toBe(1);

  const link = await linkFor(u.email);
  await page.goto(link);
  // токен только в памяти страницы
  await expect(page).toHaveURL(/\/reset$/);
  await fillNew(page, NEW_PASSWORD);
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId('password-reset-done')).toContainText('Пароль изменён');
  await loginUi(page, u.email, PASSWORD);
  await expect(page.getByText('Неверный e-mail или пароль')).toBeVisible();
  await loginUi(page, u.email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/app$/);
  await openArchive(page); // E01: экран ключа архива

  // старая сессия (до сброса) завершена
  expect(
    (await request.get(`${API_URL}/cabinet`, { headers: { Authorization: `Bearer ${u.token}` } })).status(),
  ).toBe(401);

  // та же ссылка ещё раз
  await page.goto(link);
  await fillNew(page, 'noch-ein-passwort-4');
  await page.getByRole('button', { name: 'Сохранить пароль' }).click();
  await expect(page.getByTestId('reset-invalid')).toBeVisible();
  await page.getByRole('link', { name: 'Запросить новое письмо' }).click();
  await expect(page).toHaveURL(/\/forgot$/);
});

test('обновление страницы «Новый пароль» без токена: понятная ссылка на новое письмо; неизвестный адрес — тот же ответ', async ({
  page,
}) => {
  await page.goto('/reset?token=ausgedacht');
  await expect(page).toHaveURL(/\/reset$/);
  await page.reload();
  await expect(page.getByTestId('reset-no-token')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Запросить новое письмо' })).toBeVisible();

  await page.goto('/forgot');
  await page.getByLabel('E-mail').fill(`niemand-${letters()}@example.org`);
  await page.getByRole('button', { name: 'Отправить ссылку' }).click();
  await expect(page.getByRole('status')).toContainText('Если такой адрес есть, мы отправили письмо');
});
