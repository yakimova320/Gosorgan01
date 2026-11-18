import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { createUser, loginUi } from './helpers';

test('прямое открытие вложенного адреса и обновление страницы', async ({
  page,
  request,
}) => {
  const a = await createUser(request, 'r', 'Router');
  await page.goto('/login');
  await loginUi(page, a.email);
  await expect(page).toHaveURL(/\/app$/);
  await page.goto('/app/cases/case-123/answer');
  await expect(page).toHaveURL(/\/app\/cases\/case-123\/answer$/);
  await expect(page.getByText('Такой страницы нет')).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL(/\/app\/cases\/case-123\/answer$/);
  await expect(page.getByText('Такой страницы нет')).toHaveCount(0);
});

test('query-параметры, неизвестный адрес и кнопка «Назад»', async ({
  page,
}) => {
  await page.goto('/reset');
  await expect(page.getByTestId('reset-no-token')).toBeVisible();
  await page.goto('/reset?token=abc');
  await expect(page.getByLabel('Новый пароль')).toBeVisible();
  await expect(page).toHaveURL(/\/reset$/); // A03: токен убран из адреса
  await page.goto('/nichts-hier');
  await expect(page.getByText('Такой страницы нет')).toBeVisible();
  await page.goto('/faq');
  await page.getByRole('link', { name: 'Важно знать' }).first().click();
  await expect(page).toHaveURL(/\/wissen$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/faq$/);
});

test('hash-режим (window.__JASNO_HASH__)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __JASNO_HASH__: boolean }).__JASNO_HASH__ = true;
  });
  await page.goto('/#/faq');
  await expect(
    page.getByRole('heading', { name: 'Частые вопросы' }),
  ).toBeVisible();
  await page.goto('/#/app');
  await expect(page).toHaveURL(/#\/login$/);
});

test('офлайн-сборка открывается как файл', async ({ page }) => {
  const webDir = resolve(import.meta.dirname, '..');
  execFileSync('pnpm', ['exec', 'vite', 'build', '--mode', 'offline'], {
    cwd: webDir,
    stdio: 'pipe',
  });
  const file = resolve(webDir, 'dist-offline', 'index.html');
  expect(existsSync(file)).toBeTruthy();
  const url = pathToFileURL(file).href;
  await page.goto(`${url}#/faq`);
  await expect(
    page.getByRole('heading', { name: 'Частые вопросы' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Важно знать' }).first().click();
  await expect(page).toHaveURL(/#\/wissen$/);
  await page.goto(`${url}#/app`);
  await expect(page).toHaveURL(/#\/login$/);
});
