import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_URL, createUser, letters } from './helpers';

/*
 * F05: номера в профиле попадают в черновик; экран консультаций совпадает с FAQ.
 * Настоящий API (demo).
 */

const root = resolve(import.meta.dirname, '..', '..');
type Claim = { id: string };

async function signedIn(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
}

test('номер из профиля: проверка поля, сохранение, черновик DE и RU; удаление номера', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'numbers', `Anna${letters()}`);
  const h = { Authorization: `Bearer ${u.token}` };
  await signedIn(page, u.token);
  await page.goto('/app/profile');

  await page.getByRole('button', { name: 'Добавить номер' }).click();
  const label = page.getByLabel('Название номера 1');
  const value = page.getByLabel('Номер 1', { exact: true });
  // Новая пустая строка: ошибок нет, пока поле не покинуто (правило форм v5 5.3)
  await expect(page.locator('.field-error')).toHaveCount(0);
  await label.fill('Номер клиента');
  await label.blur();
  await expect(page.locator('#p-num-0-label-error')).toHaveText(
    'Название по-немецки, как в письме ведомства',
  );
  await expect(label).toHaveAttribute('aria-invalid', 'true');
  await label.fill('Kundennummer');
  await expect(page.locator('#p-num-0-label-error')).toHaveCount(0);
  await value.fill('123A456');
  await expect(page.locator('#p-num-0-value-error')).toHaveCount(0);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Сохранено' }),
  ).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Название номера 1')).toHaveValue(
    'Kundennummer',
  );
  await expect(page.getByLabel('Номер 1', { exact: true })).toHaveValue(
    '123A456',
  );

  // Черновик: номер под адресом отправителя в обоих вариантах
  const up = await (
    await request.post(`${API_URL}/letters`, {
      headers: h,
      multipart: {
        files: {
          name: 'a.pdf',
          mimeType: 'application/pdf',
          buffer: readFileSync(
            resolve(root, 'fixtures', 'letters', '01_jobcenter_request.pdf'),
          ),
        },
      },
    })
  ).json();
  await request.post(`${API_URL}/letters/${up.letter.id}/claims/confirm`, {
    headers: h,
    data: { confirm: (up.claims as Claim[]).map((c) => c.id) },
  });
  const { caseId } = await (
    await request.post(`${API_URL}/letters/${up.letter.id}/assign`, {
      headers: h,
      data: { newCase: {} },
    })
  ).json();
  const draft = await (
    await request.post(`${API_URL}/cases/${caseId}/draft`, {
      headers: h,
      data: {
        kind: 'CLARIFICATION',
        letterId: up.letter.id,
        questionId: 'WHICH_DOCUMENTS',
      },
    })
  ).json();
  expect(draft.russianText).toContain('Kundennummer: 123A456');
  await page.goto(
    `/app/cases/${caseId}/answer/draft?draft=${draft.id}&letter=${up.letter.id}&q=WHICH_DOCUMENTS`,
  );
  await expect(page.getByTestId('german-text')).toContainText(
    'Kundennummer: 123A456',
  );

  // Удалить номер: список на сервере пустой, черновик устарел
  await page.goto('/app/profile');
  await page.getByRole('button', { name: 'Убрать номер 1' }).click();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Сохранено' }),
  ).toBeVisible();
  const cabinet = await (
    await request.get(`${API_URL}/cabinet`, { headers: h })
  ).json();
  expect(cabinet.profile.numbers).toEqual([]);
  const after = await (
    await request.get(`${API_URL}/drafts/${draft.id}`, { headers: h })
  ).json();
  expect(after.stale).toBe(true);
});

test('«Найти консультацию»: все пункты и примечание из FAQ, без адресов и цен', async ({
  page,
}) => {
  const faq = readFileSync(resolve(root, 'content', 'faq.ru.md'), 'utf8');
  const section = faq
    .split('### Куда обратиться, если нужен юридический совет?')[1]
    .split('\n### ')[0];
  const items = [...section.matchAll(/^- (.+?): (.+)$/gm)];
  expect(items.length).toBeGreaterThan(0);
  const note = section
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('- '))!;

  await page.goto('/beratung');
  for (const [, name, text] of items) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText(text.slice(1), { exact: false })).toBeVisible();
  }
  await expect(page.getByText(note)).toBeVisible();
  await expect(page.locator('main')).not.toContainText('€');
});
