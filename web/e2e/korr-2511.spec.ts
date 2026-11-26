import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { API_URL, createUser, letters, signedIn } from './helpers';

/*
 * KORR 25.11: чат и «Горячие темы» на главной, вопросы из чата в истории,
 * календарь в кабинете (не в профиле). Настоящий API (demo).
 */


test('главная: чат без входа отвечает, ничего не просит; ссылка на регистрацию', async ({ page }) => {
  await page.goto('/');
  const chat = page.getByTestId('public-chat');
  await expect(chat.getByRole('heading', { name: 'Спросите Ja!sno' })).toBeVisible();
  await chat.getByLabel('Ваш вопрос Ja!sno').fill('Что такое Anmeldung?');
  await chat.getByRole('button', { name: 'Отправить вопрос' }).click();
  await expect(chat.getByTestId('public-chat-answer')).toHaveCount(1);
  await expect(chat.getByTestId('public-chat-answer')).toContainText('Это не юридическая консультация');
  await expect(chat.getByRole('link', { name: 'Зарегистрируйтесь' })).toHaveAttribute('href', '/register');

  // пример-вопрос одной кнопкой: второй ответ, разговор продолжается
  await chat.getByLabel('Ваш вопрос Ja!sno').fill('А сколько это стоит?');
  await chat.getByLabel('Ваш вопрос Ja!sno').press('Enter');
  await expect(chat.getByTestId('public-chat-answer')).toHaveCount(2);
});

test('главная: «Горячие темы» рядом с консультацией, ссылка ведёт в блог на карточку', async ({ page }) => {
  await page.goto('/');
  const hot = page.getByTestId('hot-topics');
  await expect(hot.getByRole('heading', { name: 'Горячие темы: что важно сейчас' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Найти консультацию' })).toBeVisible();
  await hot.getByRole('link', { name: /§ 24 продлён до 4 марта 2027/ }).click();
  await expect(page).toHaveURL(/\/blog\?topic=hot#hot-24-extension$/);
  await expect(page.getByRole('tab', { name: 'Горячие темы' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#hot-24-extension')).toBeInViewport();
  await expect(page.locator('#hot-24-extension')).toContainText('проверено');
});

test('история: вопрос из чата виден и ведёт в «Спросить»; календарь в кабинете, не в профиле', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'korr2511', `Anna${letters()}`);
  await request.post(`${API_URL}/chat`, {
    headers: { Authorization: `Bearer ${u.token}` },
    data: { text: 'Как продлить ВНЖ по § 24?' },
  });
  await signedIn(page, u.token);

  await page.goto('/app/history');
  const item = page.getByTestId('history-item').filter({ hasText: 'Как продлить ВНЖ по § 24?' });
  await expect(item).toContainText('Чат с Ja!sno');
  await page.getByRole('button', { name: 'Вопросы', exact: true }).click();
  await expect(item).toBeVisible();
  await page.getByRole('button', { name: 'Письма', exact: true }).click();
  await expect(item).toHaveCount(0);
  await page.getByRole('button', { name: 'Вопросы', exact: true }).click();
  await item.click();
  await expect(page).toHaveURL(/\/app\/ask$/);

  await page.goto('/app/profile');
  await expect(page.getByTestId('calendar-profile')).toHaveCount(0);
  await page.getByRole('link', { name: 'в кабинете' }).click();
  await expect(page).toHaveURL(/\/app#calendar$/);
  await expect(page.getByTestId('calendar-profile')).toBeVisible();
});
