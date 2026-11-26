import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { createUser, fillRegistration, letters, uniqueEmail, signedIn, openArchive } from './helpers';

/*
 * K11 (#134): согласие на анализ письма ИИ. Настоящий API в режиме demo.
 */


test('без согласия: вместо загрузки — согласие; кнопка только после отметки; отзыв в профиле возвращает запрос', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'k11', `Anna${letters()}`, { aiConsent: false });
  await signedIn(page, u.token);
  await page.goto('/app/scan');
  const card = page.getByTestId('ai-consent');
  await expect(card).toBeVisible();
  await expect(page.getByRole('button', { name: 'Выбрать фото или PDF' })).toHaveCount(0);
  const box = page.getByRole('checkbox', { name: /внешней модели ИИ/ });
  await expect(box).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Дать согласие' })).toBeDisabled();
  await box.check();
  await page.getByRole('button', { name: 'Дать согласие' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Выбрать фото или PDF' })).toBeVisible();

  await page.goto('/app/profile');
  const section = page.getByTestId('ai-consent-profile');
  await expect(section).toContainText('Согласие дано');
  await section.getByRole('button', { name: 'Отозвать согласие' }).click();
  await expect(section).toContainText('Согласия нет');
  await page.goto('/app/scan');
  await expect(page.getByTestId('ai-consent')).toBeVisible();
});

test('регистрация с отметкой согласия на анализ ИИ: загрузка сразу доступна; Datenschutz открывается', async ({
  page,
}) => {
  await page.goto('/register');
  const ai = page.getByRole('checkbox', { name: /внешней модели ИИ/ });
  await expect(ai).not.toBeChecked();
  await fillRegistration(page, { email: uniqueEmail('k11reg'), firstName: `Anna${letters()}`, aiConsent: true });
  await page.getByRole('button', { name: 'Зарегистрироваться' }).click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 15_000 });
  await openArchive(page); // E01: экран ключа архива
  await page.goto('/app/scan');
  await expect(page.getByRole('button', { name: 'Выбрать фото или PDF' })).toBeVisible();
  await expect(page.getByTestId('ai-consent')).toHaveCount(0);

  await page.goto('/datenschutz');
  await expect(page.getByRole('heading', { name: /Анализ писем ИИ/ })).toBeVisible();
});
