import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API_URL = process.env.JASNO_E2E_API_URL ?? 'http://127.0.0.1:3100';
export const PASSWORD = 'e2e-lange-passwort-1';

export function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.org`;
}

/** Регистрация через API и имя в профиле, чтобы данные пользователей отличались. */
export async function createUser(
  request: APIRequestContext,
  tag: string,
  firstName: string,
) {
  const email = uniqueEmail(tag);
  const reg = await request.post(`${API_URL}/auth/register`, {
    data: { email, password: PASSWORD, consent: true },
  });
  expect(reg.status()).toBe(201);
  const { sessionToken } = (await reg.json()) as { sessionToken: string };
  const patch = await request.patch(`${API_URL}/cabinet`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
    data: { profile: { firstName } },
  });
  expect(patch.ok()).toBeTruthy();
  return { email, firstName };
}

export async function loginUi(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();
}

/** Переход внутри сайта без перезагрузки страницы: кэш и состояние в памяти сохраняются. */
export async function clientNavigate(page: Page, path: string) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}
