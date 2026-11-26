import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { API_URL, createUser, letters, signedIn } from './helpers';

/* B07 на сайте: «В дело» со страницы проверки, статус дела в кабинете (настоящий API, demo). */

const fixture = (name: string) =>
  resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name);
const claim = (page: Page, text: string) =>
  page.getByTestId('claim').filter({ hasText: text });
// у каждого теста свой пользователь и одно дело; название дела — предложенное название письма (поправка 8)
const caseCard = (page: Page) => page.getByTestId('case-row').first();


async function uploadAndCheck(page: Page, file: string): Promise<string> {
  await page.goto('/app/scan');
  await page.getByTestId('file-input').setInputFiles(fixture(file));
  await page.getByRole('button', { name: 'Готово, читать письмо' }).click();
  await expect(page).toHaveURL(/\/check$/, { timeout: 30_000 });
  return page.url();
}

test('в дело: «Нужна проверка», после подтверждения срока — статус по сроку', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'case', `Anna${letters()}`);
  await signedIn(page, u.token);
  const checkUrl = await uploadAndCheck(page, '01_jobcenter_request.pdf');

  await page.getByRole('radio', { name: 'Новое дело' }).check();
  // поправка 8: название нового дела заполнено названием письма от Ja!sno, его можно изменить
  await expect(page.getByLabel('Название дела (можно изменить)')).toHaveValue('Jobcenter: документы к заявлению');
  await page.getByRole('button', { name: 'В дело', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(caseCard(page)).toContainText('Jobcenter: документы к заявлению');
  await expect(caseCard(page)).toContainText('Нужна проверка');
  // поправка 14: прогресс по шагам дела
  await expect(caseCard(page).getByTestId('case-progress')).toContainText('из 3');
  await expect(page.getByTestId('inbox-letter')).toHaveCount(0);

  // только срок: подтверждённый срок важнее остальных непроверенных фактов
  await page.goto(checkUrl);
  await claim(page, 'Срок: до')
    .getByRole('button', { name: 'Верно', exact: true })
    .click();
  await page.getByRole('button', { name: 'Сохранить проверку (1)' }).click();
  await expect(page.getByTestId('deadline')).toContainText('Действует');
  await page.goto('/app');
  const res = await request.get(`${API_URL}/cases`, {
    headers: { Authorization: `Bearer ${u.token}` },
  });
  const kase = (await res.json())[0] as { stage: string; nextDeadline: string };
  expect(kase.nextDeadline).toBe('2026-11-30');
  const expected = {
    DOCUMENTS: 'Нужны документы',
    REPLY: 'Нужен ответ',
    OVERDUE: 'Просрочено',
  }[kase.stage];
  expect(expected).toBeTruthy(); // по виду и дате срока, не «Нужна проверка»
  await expect(caseCard(page)).toContainText(expected!);
});

test('несохранённые решения перед «В дело»: сохранить и положить — решения не теряются', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'save', `Anna${letters()}`);
  await signedIn(page, u.token);
  const checkUrl = await uploadAndCheck(page, '01_jobcenter_request.pdf');
  const letterId = checkUrl.split('/letters/')[1].split('/')[0];

  await claim(page, 'Ведомство: ')
    .getByRole('button', { name: 'Верно', exact: true })
    .click();
  await page.getByRole('radio', { name: 'Новое дело' }).check();
  await page.getByRole('button', { name: 'В дело', exact: true }).click();
  await expect(
    page.getByRole('alertdialog', {
      name: 'Несохранённые решения перед делом',
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить и положить' }).click();
  await expect(page).toHaveURL(/\/app$/);

  const detail = await (
    await request.get(`${API_URL}/letters/${letterId}`, {
      headers: { Authorization: `Bearer ${u.token}` },
    })
  ).json();
  expect(detail.letter.caseId).not.toBeNull();
  expect(
    detail.claims.find((c: { kind: string }) => c.kind === 'AUTHORITY').status,
  ).toBe('CONFIRMED');
  // название из подтверждённого ведомства
  await expect(page.getByTestId('case-row').first()).toContainText(
    'Jobcenter Musterstadt',
  );
});

test('несохранённые решения перед «В дело»: отменить решения', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'drop', `Anna${letters()}`);
  await signedIn(page, u.token);
  const checkUrl = await uploadAndCheck(page, '04_buergeramt.pdf');
  const letterId = checkUrl.split('/letters/')[1].split('/')[0];

  await claim(page, 'Ведомство: ')
    .getByRole('button', { name: 'Верно', exact: true })
    .click();
  await page.getByRole('button', { name: 'В дело', exact: true }).click();
  await page.getByRole('button', { name: 'Отменить решения' }).click();
  await page.getByRole('button', { name: 'В дело', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
  const detail = await (
    await request.get(`${API_URL}/letters/${letterId}`, {
      headers: { Authorization: `Bearer ${u.token}` },
    })
  ).json();
  expect(
    detail.claims.every((c: { status: string }) => c.status === 'UNCONFIRMED'),
  ).toBe(true);
  await expect(caseCard(page)).toContainText('Нужна проверка');
});
