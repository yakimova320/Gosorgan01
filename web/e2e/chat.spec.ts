import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { createUser, letters, signedIn } from './helpers';

/* Чат-помощник (24.11): свободный вопрос, ответ по FAQ в режиме demo, пометка под каждым ответом. */


test('чат: вопрос, ответ с пометкой, история после перезагрузки, очистка', async ({ page, request }) => {
  const u = await createUser(request, 'chat', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app');
  await page.getByRole('navigation', { name: 'Главное меню' }).first().getByRole('link', { name: 'Спросить Ja!sno' }).click();
  await expect(page).toHaveURL(/\/app\/ask$/);

  const box = page.getByLabel('Ваш вопрос');
  await box.fill('Можно ли войти через Google или Apple?');
  await box.press('Enter');
  const answer = page.getByTestId('chat-answer').first();
  await expect(answer).toContainText('Похожий вопрос есть в FAQ');
  await expect(answer.getByTestId('chat-disclaimer')).toHaveText(/не юридическая консультация.*может ошибаться/);

  await page.getByRole('button', { name: 'Что такое Anmeldung и как её сделать?' }).waitFor({ state: 'detached' });
  await box.fill('Какая погода на Марсе?');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByTestId('chat-answer')).toHaveCount(2);
  await expect(page.getByTestId('chat-disclaimer')).toHaveCount(2);

  await page.reload();
  await expect(page.getByTestId('chat-answer')).toHaveCount(2);

  await page.getByRole('button', { name: 'Очистить разговор' }).click();
  await expect(page.getByTestId('chat-answer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Что такое Anmeldung и как её сделать?' })).toBeVisible();
});

test('390 px: чат открывается из шапки кабинета, без горизонтальной прокрутки', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const u = await createUser(request, 'chat-m', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app');
  await page.getByTestId('ask-link').click();
  await expect(page).toHaveURL(/\/app\/ask$/);
  await page.getByRole('button', { name: 'Где получить бесплатную консультацию?' }).click();
  await expect(page.getByTestId('chat-answer')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
