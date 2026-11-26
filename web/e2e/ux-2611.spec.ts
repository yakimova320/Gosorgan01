import { expect } from '@playwright/test';
import { test } from './fixtures';
import { createUser, letters, signedIn } from './helpers';

/*
 * UX 26.11 (#168): бургер-меню, плавающий чат, «А вы знали, что…?», «Полезно знать»,
 * меню кабинета на телефоне, язык с клавиатуры, AGB. Настоящий API (demo).
 */

const noHScroll = () => document.documentElement.scrollWidth <= window.innerWidth;

test('публичный бургер: открывается, Esc закрывает с фокусом на кнопке, пункты ведут куда нужно', async ({ page }) => {
  await page.goto('/faq');
  const button = page.getByTestId('public-menu-button');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  const menu = page.getByTestId('public-menu');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['Главная страница', 'Кабинет', 'Как это работает?', 'Задать вопрос', 'Блог', 'FAQ'])
    await expect(menu.getByRole(name === 'Задать вопрос' ? 'button' : 'link', { name })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button).toBeFocused();

  await button.click();
  await menu.getByRole('link', { name: 'Как это работает?' }).click();
  await expect(page).toHaveURL(/\/#how$/);
  await expect(page.locator('#how')).toBeInViewport();
  await expect(page.getByRole('heading', { name: 'Как это работает в 3 шага?' })).toBeVisible();

  await button.click();
  await menu.getByRole('link', { name: 'Кабинет' }).click();
  await expect(page).toHaveURL(/\/login$/);

  // «Задать вопрос» открывает плавающий чат
  await page.getByTestId('public-menu-button').click();
  await page.getByTestId('public-menu').getByRole('button', { name: 'Задать вопрос' }).click();
  await expect(page.getByTestId('chat-panel')).toBeVisible();
});

test('плавающий чат: открывается, вопрос уходит, ответ виден, Esc закрывает', async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/blog');
    const launcher = page.getByTestId('chat-launcher');
    await expect(launcher).toHaveText('Спроси Ja!sno');
    await launcher.click();
    const panel = page.getByTestId('chat-panel');
    await expect(panel.getByRole('heading', { name: 'Спросите Ja!sno' })).toBeVisible();
    await expect(panel.getByLabel('Ваш вопрос Ja!sno')).toBeFocused();
    await panel.getByLabel('Ваш вопрос Ja!sno').fill('Что такое Anmeldung?');
    await panel.getByLabel('Ваш вопрос Ja!sno').press('Enter');
    await expect(panel.getByTestId('public-chat-answer')).toContainText('Это не юридическая консультация');
    const box = await panel.boundingBox();
    if (width === 390) expect(box?.width).toBe(390); // телефон: на весь экран
    else expect(box!.width).toBeLessThanOrEqual(400);
    expect(await page.evaluate(noHScroll)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByTestId('chat-launcher')).toBeFocused();
  }
  // на главной блока чата больше нет
  await page.goto('/');
  await expect(page.getByTestId('public-chat')).toHaveCount(0);
});

test('главная: в блоге 4 темы «А вы знали, что…?», остальные по кнопке; «Полезно знать» с FAQ', async ({ page }) => {
  await page.goto('/');
  const facts = page.getByTestId('facts-list');
  await expect(facts.getByRole('listitem')).toHaveCount(4);
  const more = page.getByRole('button', { name: 'Ещё актуальные темы' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  expect(await facts.getByRole('listitem').count()).toBeGreaterThan(4);
  await expect(page.getByRole('button', { name: 'Свернуть' })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Важное о жизни в Германии — просто и понятно')).toBeVisible();

  const good = page.getByTestId('good-to-know');
  await expect(good.getByRole('heading', { name: 'Полезно знать' })).toBeVisible();
  await expect(good.locator('details')).toHaveCount(4);
  await good.getByText('Может ли Ja!sno ошибиться?').click();
  await expect(good.locator('details[open] .faq-body')).toBeVisible();
  await good.getByRole('link', { name: 'К глоссарию' }).click();
  await expect(page).toHaveURL(/\/glossary$/);
});

test('кабинет 390 px: в шапке только логотип, меню снизу раскрывается вверх, в панели «Мои дела»', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const u = await createUser(request, 'ux2611', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/profile');
  const topbar = page.locator('.app-topbar');
  await expect(topbar.getByTestId('lang-switcher')).toHaveCount(0);
  await expect(topbar.getByRole('link')).toHaveCount(1);

  const nav = page.locator('.bottom-nav');
  await expect(nav.getByRole('link', { name: 'Мои дела' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'История' })).toHaveCount(0);

  const button = page.getByTestId('cabinet-menu-button');
  await button.click();
  const sheet = page.getByTestId('cabinet-menu');
  const sheetBox = await sheet.boundingBox();
  const navBox = await nav.boundingBox();
  expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(navBox!.y + 1); // над панелью
  for (const name of ['Главная', 'Мои дела', 'История', 'Спросить Ja!sno', 'Написать письмо', 'Блог', 'Глоссарий', 'Профиль'])
    await expect(sheet.getByRole('link', { name })).toBeVisible();
  await expect(sheet.getByTestId('lang-switcher')).toBeVisible();
  // кнопка чата не закрывает нижнюю панель
  const fab = await page.getByTestId('chat-launcher').boundingBox();
  expect(fab!.y + fab!.height).toBeLessThanOrEqual(navBox!.y);
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(button).toBeFocused();

  await button.click();
  await sheet.getByRole('link', { name: 'История' }).click();
  await expect(page).toHaveURL(/\/app\/history$/);
  expect(await page.evaluate(noHScroll)).toBe(true);
});

test('язык с клавиатуры: ↓ открывает, Enter выбирает; у AR нет флага, у RU/UA/DE есть', async ({ page }) => {
  await page.goto('/');
  const sw = page.getByTestId('lang-switcher');
  await expect(sw.locator('svg[data-flag="ru"]')).toBeVisible();
  await sw.focus();
  await page.keyboard.press('ArrowDown');
  const list = page.getByTestId('lang-list');
  await expect(list).toBeFocused();
  for (const code of ['ru', 'uk', 'de', 'tr', 'es', 'cs'])
    await expect(list.locator(`[data-lang="${code}"] svg[data-flag="${code}"]`)).toHaveCount(1);
  await expect(list.locator('[data-lang="ar"] svg')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  await expect(sw).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown'); // RU → UA
  await page.keyboard.press('ArrowDown'); // UA → DE
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Ein Brief vom Amt?' })).toBeVisible();
  await expect(page.getByTestId('lang-switcher')).toHaveAttribute('data-value', 'de');
  await expect(page.getByRole('heading', { name: 'Wie funktioniert das in 3 Schritten?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Wussten Sie, dass…?' })).toBeVisible();
  await expect(page.getByTestId('site-footer').getByRole('link', { name: 'Glossar' })).toBeVisible();
});

test('подвал: Impressum, Datenschutz, AGB открываются; у AGB баннер черновика и немецкая версия', async ({ page }) => {
  for (const [name, url, heading] of [
    ['Impressum', /\/impressum$/, 'Impressum'],
    ['Datenschutz', /\/datenschutz$/, 'Datenschutz'],
    ['AGB', /\/agb$/, 'AGB'],
  ] as const) {
    await page.goto('/faq');
    await page.getByTestId('site-footer').getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByTestId('legal-draft')).toContainText('Entwurf, juristisch nicht geprüft.');
  }
  await expect(page.getByRole('heading', { name: '3. Это не юридическая консультация' })).toBeVisible();
  await page.getByRole('button', { name: 'Deutsch (maßgeblich)' }).click();
  await expect(page.getByTestId('legal-agb')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('heading', { name: '3. Keine Rechtsberatung' })).toBeVisible();

  // при регистрации ссылка на AGB рядом с Datenschutz
  await page.goto('/register');
  await expect(page.getByRole('link', { name: 'AGB' }).first()).toHaveAttribute('href', '/agb');
});
