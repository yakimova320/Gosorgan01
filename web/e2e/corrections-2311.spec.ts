import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { createUser, letters, signedIn } from './helpers';

/* Поправки 23.11, вечер: подвал на всех страницах, «Главная» в кабинете, приветствие в меню, адрес по частям. */


test('кабинет: общий подвал, «Главная» и приветствие с именем в боковом меню', async ({ page, request }) => {
  const name = `Anna${letters()}`;
  const u = await createUser(request, 'footer', name);
  await signedIn(page, u.token);
  await page.goto('/app');
  const footer = page.getByTestId('site-footer');
  for (const link of ['На главную Ja!sno', 'Блог', 'FAQ', 'Impressum', 'Datenschutz'])
    await expect(footer.getByRole('link', { name: link })).toBeVisible();
  await expect(page.getByTestId('side-nav-user')).toContainText(name);
  await page.getByRole('navigation', { name: 'Главное меню' }).first().getByRole('link', { name: 'Главная' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('390 px: в кабинете кнопка «Главная» над страницей', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const u = await createUser(request, 'home', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/history');
  await page.getByTestId('home-link').click();
  await expect(page).toHaveURL(/\/$/);
});

test('профиль: адрес по частям, старая строка разобрана, сохраняется целиком', async ({ page, request }) => {
  const u = await createUser(request, 'addr', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/profile');
  await expect(page.getByLabel('Улица и номер дома')).toHaveValue('Musterstr. 1');
  await expect(page.getByLabel('Индекс')).toHaveValue('10115');
  await expect(page.getByLabel('Город')).toHaveValue('Berlin');

  await page.getByLabel('Индекс').fill('123');
  await page.getByLabel('Город').click();
  await expect(page.getByText('Индекс: 5 цифр')).toBeVisible();

  await page.getByLabel('Индекс').fill('50667');
  await page.getByLabel('Город').fill('Köln');
  await page.getByRole('button', { name: /Сохранить/ }).first().click();
  await expect(page.getByText(/Сохранено/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Город')).toHaveValue('Köln');
});
