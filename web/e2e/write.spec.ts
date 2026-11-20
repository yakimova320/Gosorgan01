import { expect, test, type Page } from '@playwright/test';
import { API_URL, createUser, letters } from './helpers';

/*
 * B16: своё письмо по шаблону (экраны 22–25) → дело OUTGOING → обычный экран черновика.
 * Настоящий API (demo).
 */

async function signedIn(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
}

const addDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

test('новый банковский счёт: каталог, адресат, детали с ошибкой IBAN, проверка, черновик и дело', async ({ page, request }) => {
  const u = await createUser(request, 'write', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/write');

  // Экран 22: шесть шаблонов из каталога сервера
  await expect(page.getByTestId('template-card')).toHaveCount(6);
  await page.getByRole('link', { name: /Новый банковский счёт/ }).click();

  // Экран 23: адресат. Ошибка после ухода из поля, не раньше
  const name = page.getByLabel('Ведомство или организация');
  await expect(page.locator('.field-error')).toHaveCount(0);
  await name.fill('Джобцентр');
  await name.blur();
  await expect(page.locator('#w-recipient-name-error')).toHaveText('Название ведомства латиницей, как в его письмах');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await name.fill('Jobcenter Berlin Mitte');
  await expect(page.locator('#w-recipient-name-error')).toHaveCount(0);
  await page.getByLabel('Адрес').fill('Postfach 1234\n10115 Berlin');
  await page.getByRole('button', { name: 'Дальше' }).click();

  // Экран 24: детали
  await expect(page.getByRole('heading', { name: /что написать/ })).toBeVisible();
  const iban = page.getByLabel('Новый IBAN');
  await iban.fill('DE89 3704 0044 0532 0130 01');
  await iban.blur();
  await expect(page.locator('#w-iban-error')).toHaveText('Проверьте IBAN: в нём ошибка');
  await iban.fill('DE89 3704 0044 0532 0130 00');
  await expect(page.locator('#w-iban-error')).toHaveCount(0);
  await page.getByLabel('Номер дела или клиента (необязательно)').fill('123A456789');

  // Назад и снова вперёд: значения не теряются
  await page.goBack();
  await expect(page.getByLabel('Ведомство или организация')).toHaveValue('Jobcenter Berlin Mitte');
  await page.getByRole('button', { name: 'Дальше' }).click();
  await expect(page.getByLabel('Новый IBAN')).toHaveValue('DE89 3704 0044 0532 0130 00');
  await page.getByRole('button', { name: 'Дальше' }).click();

  // Экран 25: проверка
  const check = page.getByTestId('write-check');
  await expect(check).toContainText('Jobcenter Berlin Mitte');
  await expect(check).toContainText('DE89 3704 0044 0532 0130 00');
  await expect(check).toContainText(`${u.firstName} Muster`);
  await page.getByRole('button', { name: 'Всё верно, собрать письмо' }).click();

  // Обычный экран черновика
  await expect(page).toHaveURL(/\/answer\/draft\?draft=/);
  await expect(page.getByRole('heading', { name: 'Черновик: новый банковский счёт' })).toBeVisible();
  const german = page.getByTestId('german-text');
  await expect(german).toContainText('Betreff: Neue Bankverbindung');
  await expect(german).toContainText('IBAN: DE89 3704 0044 0532 0130 00');
  await expect(german).toContainText('Ihr Zeichen: 123A456789');
  await page.getByTestId('draft-sources').click();
  await expect(page.getByTestId('draft-sources')).toContainText('Новый IBAN: DE89 3704 0044 0532 0130 00');
  await expect(page.getByRole('button', { name: 'PDF для печати' })).toBeEnabled();

  // Дело в списке с пометкой и ссылкой на письмо
  await page.goto('/app/cases');
  const row = page.getByTestId('case-row').filter({ hasText: 'Новый банковский счёт: Jobcenter Berlin Mitte' });
  await expect(row).toContainText('Своё письмо · Jobcenter Berlin Mitte');
  await row.click();
  await expect(page.getByTestId('own-letter')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Подготовить ответ' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Открыть письмо' }).click();
  await expect(page.getByTestId('german-text')).toContainText('IBAN: DE89 3704 0044 0532 0130 00');
});

test('продление срока: прошедший срок отклоняет сервер; профиль изменился → «Собрать заново»', async ({ page, request }) => {
  const u = await createUser(request, 'write-ext', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app/write/FRISTVERLAENGERUNG');
  await page.getByLabel('Ведомство или организация').fill('Familienkasse Berlin');
  await page.getByLabel('Адрес').fill('Postfach 5678, 10115 Berlin');
  await page.getByRole('button', { name: 'Дальше' }).click();

  await page.getByLabel('Текущий срок').fill(addDays(-3));
  await page.getByLabel('Причина').selectOption('ADVICE');
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Всё верно, собрать письмо' }).click();
  // Ошибка сервера возвращает к полю
  await expect(page.locator('#w-deadline-error')).toHaveText('Срок уже прошёл: продлить можно только будущий срок');

  await page.getByLabel('Текущий срок').fill(addDays(10));
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: 'Всё верно, собрать письмо' }).click();
  await expect(page.getByTestId('german-text')).toContainText('Ich möchte mich vorher beraten lassen.');

  // Адрес в профиле изменился: черновик устарел, сборка заново берёт новый адрес
  const patch = await request.patch(`${API_URL}/cabinet`, {
    headers: { Authorization: `Bearer ${u.token}` },
    data: { profile: { address: 'Neue Str. 5, 10117 Berlin' } },
  });
  expect(patch.status()).toBe(200);
  await page.reload();
  await expect(page.getByTestId('draft-stale')).toBeVisible();
  await page.getByRole('button', { name: 'Собрать заново' }).click();
  await expect(page.getByTestId('draft-stale')).toHaveCount(0);
  await expect(page.getByTestId('german-text')).toContainText('Neue Str. 5, 10117 Berlin');
});
