import { expect, type APIRequestContext, type Page } from '@playwright/test';

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
) {
  const email = uniqueEmail(tag);
  const reg = await request.post(`${API_URL}/auth/register`, {
    data: {
      email,
      password: PASSWORD,
      consent: true,
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
  if (data.consent !== false) await page.getByRole('checkbox').check();
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
