import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { adoptVault, rememberVault, vaultFor, vaultForCabinet } from './vault-client';

export const API_URL = process.env.JASNO_E2E_API_URL ?? 'http://127.0.0.1:3100';
export const PASSWORD = 'e2e-lange-passwort-1';

export function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.org`;
}

/** Уникальные латинские буквы для имён в тестах (цифры в имени не допускаются). */
export function letters(n = 6): string {
  return Array.from({ length: n }, () =>
    String.fromCharCode(97 + Math.floor(Math.random() * 26)),
  ).join('');
}

export const ADDRESS = 'Musterstr. 1, 10115 Berlin';

/** Регистрация через API с именем, фамилией и адресом. Имя делает данные пользователей различимыми. */
export async function createUser(
  request: APIRequestContext,
  tag: string,
  firstName: string,
  options: { aiConsent?: boolean } = {},
) {
  const email = uniqueEmail(tag);
  const reg = await request.post(`${API_URL}/auth/register`, {
    data: {
      email,
      password: PASSWORD,
      consent: true,
      aiConsent: options.aiConsent ?? true,
      firstName,
      lastName: 'Muster',
      address: ADDRESS,
    },
  });
  expect(reg.status()).toBe(201);
  const { sessionToken } = (await reg.json()) as { sessionToken: string };
  return { email, firstName, token: sessionToken };
}

/** Поля регистрации на сайте (без кнопки отправки). */
export async function fillRegistration(
  page: Page,
  data: {
    email: string;
    firstName?: string;
    lastName?: string;
    address?: string;
    consent?: boolean;
    /** K11: отдельное согласие на анализ ИИ (по умолчанию не отмечено) */
    aiConsent?: boolean;
  },
) {
  await page.getByLabel('Имя', { exact: true }).fill(data.firstName ?? 'Anna');
  await page
    .getByLabel('Фамилия', { exact: true })
    .fill(data.lastName ?? 'Muster');
  await page.getByLabel('Адрес проживания').fill(data.address ?? ADDRESS);
  await page.getByLabel('E-mail').fill(data.email);
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Повторите пароль').fill(PASSWORD);
  if (data.consent !== false)
    await page.getByRole('checkbox', { name: /обработкой моих данных/ }).check();
  if (data.aiConsent)
    await page.getByRole('checkbox', { name: /внешней модели ИИ/ }).check();
}

export async function loginUi(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
}

/** Переход внутри сайта без перезагрузки страницы: кэш и состояние в памяти сохраняются. */
export async function clientNavigate(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

/**
 * E01 (#163): вход по токену и открытый архив.
 * Ключ архива уже создан тестом через API (vault-client): экран «Откройте архив», ввод секрета.
 * Ключа ещё нет: экран «Ключ вашего архива» в браузере; секрет запоминается для запросов теста.
 * Дальше это устройство (контекст браузера) разблокировано. Возвращает секрет, если ключ создан сейчас.
 */
export async function signedIn(page: Page, token: string): Promise<string | null> {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
  await page.goto('/app');
  return openArchive(page, token);
}

/** Пройти экран ключа архива, если он показан. Секрет — если ключ создан сейчас. */
export async function openArchive(page: Page, token?: string): Promise<string | null> {
  const setup = page.getByTestId('vault-setup');
  const unlock = page.getByTestId('vault-unlock');
  const open = page.getByTestId('vault-open');
  await expect(setup.or(unlock).or(open).first()).toBeAttached({ timeout: 15_000 });
  const pageToken = token ?? (await page.evaluate(() => localStorage.getItem('jasno.session'))) ?? undefined;
  if (await unlock.isVisible()) {
    let known = pageToken ? vaultFor(pageToken) : undefined;
    if (!known && pageToken) {
      const res = await page.request.get(`${API_URL}/crypto/vault`, {
        headers: { Authorization: `Bearer ${pageToken}` },
      });
      known = vaultForCabinet(((await res.json()) as { cabinetId: string }).cabinetId);
    }
    if (!known) throw new Error('архив закрыт, а секрет тесту неизвестен');
    if (pageToken) rememberVault(pageToken, known);
    // по id и testid: экран может быть на любом языке сайта
    await page.locator('#recovery-secret').fill(known.secret);
    await page.getByTestId('vault-unlock-submit').click();
    await expect(open).toBeAttached({ timeout: 15_000 });
    return null;
  }
  if (!(await setup.isVisible())) return null;
  const secret = (await page.getByTestId('recovery-secret').textContent())?.trim() ?? null;
  await page.locator('#vault-saved').check();
  await page.getByTestId('vault-create').click();
  await expect(open).toBeAttached({ timeout: 15_000 });
  if (secret && pageToken) await adoptVault(page.request, pageToken, secret);
  return secret;
}

/** UX 26.11 (#168): выбрать язык в своём выпадающем списке (не select). */
export async function chooseLang(page: Page, code: 'ru' | 'uk' | 'de') {
  await page.getByTestId('lang-switcher').first().click();
  await page.getByTestId('lang-list').locator(`[data-lang="${code}"]`).click();
}
