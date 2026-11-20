import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { API_URL, createUser, letters } from './helpers';

/*
 * F04: экран черновика. Устаревание и основной успех — через настоящий API (demo);
 * подменённые ответы сервера — только для проверки интерфейса.
 */

const fixture = (name: string) =>
  resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name);
type Claim = { id: string; kind: string; supersedesId: string | null };

async function signedIn(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
}

/** Письмо 01 с подтверждёнными фактами в новом деле и черновик по API. */
async function prepared(request: APIRequestContext, token: string) {
  const h = { Authorization: `Bearer ${token}` };
  const up = await (
    await request.post(`${API_URL}/letters`, {
      headers: h,
      multipart: {
        files: {
          name: 'a.pdf',
          mimeType: 'application/pdf',
          buffer: readFileSync(fixture('01_jobcenter_request.pdf')),
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
  const url = `/app/cases/${caseId}/answer/draft?draft=${draft.id}&letter=${up.letter.id}&q=WHICH_DOCUMENTS`;
  return {
    h,
    caseId,
    letterId: up.letter.id as string,
    claims: up.claims as Claim[],
    draftId: draft.id as string,
    url,
  };
}

test('исправленный факт: «Данные изменились после сборки», копирование закрыто; новая версия подтверждена → собрать заново', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'stale', `Anna${letters()}`);
  const p = await prepared(request, u.token);
  await signedIn(page, u.token);
  await page.goto(p.url);
  await page.getByText('Основания (на момент сборки)').click();
  await expect(page.getByTestId('draft-sources')).toContainText('JC-2026-1001');

  const caseNo = p.claims.find((c) => c.kind === 'CASE_NUMBER')!;
  const corrected = await (
    await request.post(
      `${API_URL}/letters/${p.letterId}/claims/${caseNo.id}/correct`,
      { headers: p.h, data: { value: 'JC-2026-1002' } },
    )
  ).json();
  await page.reload();
  await expect(page.getByTestId('draft-stale')).toContainText(
    'Данные изменились после сборки',
  );
  await expect(
    page.getByRole('button', { name: 'Скопировать немецкий текст' }),
  ).toBeDisabled();
  // основания — снимок: старый номер остаётся у старого текста
  await page.getByText('Основания (на момент сборки)').click();
  await expect(page.getByTestId('draft-sources')).toContainText('JC-2026-1001');

  // новая версия факта снова неподтверждённая: сначала подтвердить, потом собрать заново
  const fresh = (corrected.claims as Claim[]).find(
    (c) => c.supersedesId === caseNo.id,
  )!;
  await request.post(`${API_URL}/letters/${p.letterId}/claims/confirm`, {
    headers: p.h,
    data: { confirm: [fresh.id] },
  });
  await page.getByRole('button', { name: 'Собрать заново' }).click();
  await expect(page.getByTestId('draft-stale')).toHaveCount(0);
  await expect(page.getByTestId('german-text')).toContainText(
    'Ihr Zeichen: JC-2026-1002',
  );
  expect(new URL(page.url()).searchParams.get('draft')).not.toBe(p.draftId);
});

test('перед копированием состояние перечитывается: изменение профиля после открытия блокирует копирование', async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const u = await createUser(request, 'prof', `Anna${letters()}`);
  const p = await prepared(request, u.token);
  await signedIn(page, u.token);
  await page.goto(p.url);
  await page.evaluate(() => navigator.clipboard.writeText('пусто'));
  await request.patch(`${API_URL}/cabinet`, {
    headers: p.h,
    data: { profile: { address: 'Andere Str. 3, 50667 Köln' } },
  });
  await page
    .getByRole('button', { name: 'Скопировать немецкий текст' })
    .click();
  await expect(page.getByTestId('draft-stale')).toContainText(
    'Данные изменились после сборки',
  );
  await expect(page.getByText('Скопировано')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'пусто',
  );
});

test('ошибка проверки актуальности — не разрешение копировать; ручное копирование, если буфер недоступен', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'copy', `Anna${letters()}`);
  const p = await prepared(request, u.token);
  await signedIn(page, u.token);
  await page.goto(p.url);
  await page.route(`${API_URL}/drafts/${p.draftId}`, (r) =>
    r.fulfill({
      status: 500,
      contentType: 'application/json',
      body: '{"code":"INTERNAL_ERROR","message":"x"}',
    }),
  );
  await page
    .getByRole('button', { name: 'Скопировать немецкий текст' })
    .click();
  await expect(page.getByTestId('draft-stale')).toContainText(
    'Копирование недоступно',
  );
  await expect(page.getByText('Скопировано')).toHaveCount(0);

  await page.unroute(`${API_URL}/drafts/${p.draftId}`);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('denied')) },
      configurable: true,
    });
  });
  await page.reload();
  await page
    .getByRole('button', { name: 'Скопировать немецкий текст' })
    .click();
  await expect(page.getByTestId('manual-copy')).toBeVisible();
  await expect(page.getByText('Скопировано')).toHaveCount(0);
  const german = await page.getByTestId('german-text').textContent();
  await expect(page.getByLabel('Текст для ручного копирования')).toHaveValue(
    german!,
  );
});

test('ошибка сборки: без автоматического повтора POST, вопросы перечитываются', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'err', `Anna${letters()}`);
  const p = await prepared(request, u.token);
  await signedIn(page, u.token);
  let posts = 0;
  let questionLoads = 0;
  page.on(
    'request',
    (r) =>
      r.url().endsWith(`/letters/${p.letterId}/draft-questions`) &&
      questionLoads++,
  );
  await page.route(`${API_URL}/cases/${p.caseId}/draft`, (r) => {
    posts++;
    return r.fulfill({
      status: 409,
      contentType: 'application/json',
      body: '{"code":"DRAFT_SOURCES_CHANGED","message":"x"}',
    });
  });
  await page.goto(`/app/cases/${p.caseId}/answer/details?letter=${p.letterId}`);
  await page.getByTestId('question').first().locator('input').check();
  const before = questionLoads;
  await page.getByRole('button', { name: 'Собрать черновик' }).click();
  await expect(page.getByTestId('draft-error')).toContainText(
    'Данные изменились, пока собирался черновик',
  );
  await page.waitForTimeout(800);
  expect(posts).toBe(1);
  expect(questionLoads).toBeGreaterThan(before);
});

test('двойное нажатие: один черновик; чужой черновик и черновик другого дела не показываются', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'dbl', `Anna${letters()}`);
  const p = await prepared(request, u.token);
  await signedIn(page, u.token);
  let posts = 0;
  page.on(
    'request',
    (r) =>
      r.method() === 'POST' &&
      r.url() === `${API_URL}/cases/${p.caseId}/draft` &&
      posts++,
  );
  await page.goto(`/app/cases/${p.caseId}/answer/details?letter=${p.letterId}`);
  await page.getByTestId('question').first().locator('input').check();
  await page.getByRole('button', { name: 'Собрать черновик' }).dblclick();
  await expect(page).toHaveURL(/\/answer\/draft\?/);
  expect(posts).toBe(1);
  const kase = await (
    await request.get(`${API_URL}/cases/${p.caseId}`, { headers: p.h })
  ).json();
  expect(kase.drafts).toHaveLength(2); // один из prepared() и один отсюда

  const other = await createUser(request, 'oth', `Bruno${letters()}`);
  await signedIn(page, other.token);
  await page.goto(p.url);
  await expect(
    page.getByRole('heading', { name: 'Черновик не найден' }),
  ).toBeVisible();
  await expect(page.getByText('Sehr geehrte')).toHaveCount(0);

  await signedIn(page, u.token);
  const second = await prepared(request, u.token);
  await page.goto(
    `/app/cases/${second.caseId}/answer/draft?draft=${p.draftId}`,
  );
  await expect(
    page.getByRole('heading', { name: 'Черновик не найден' }),
  ).toBeVisible();
});

test('B15: «PDF для печати» скачивает PDF; кириллица в адресе — понятная ошибка с подсказкой', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'pdf', `Anna${letters()}`);
  const p = await prepared(request, u.token);
  await signedIn(page, u.token);
  await page.goto(p.url);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'PDF для печати' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('brief.pdf');
  expect(readFileSync((await download.path())!).subarray(0, 5).toString('latin1')).toBe('%PDF-');

  // адрес кириллицей: черновик собирается, но PDF честно отказывает
  await request.patch(`${API_URL}/cabinet`, {
    headers: p.h,
    data: { profile: { address: 'ул. Мира 1, 10115 Berlin' } },
  });
  const fresh = await (
    await request.post(`${API_URL}/cases/${p.caseId}/draft`, {
      headers: p.h,
      data: { kind: 'CLARIFICATION', letterId: p.letterId, questionId: 'REASON' },
    })
  ).json();
  await page.goto(`/app/cases/${p.caseId}/answer/draft?draft=${fresh.id}&letter=${p.letterId}&q=REASON`);
  await page.getByRole('button', { name: 'PDF для печати' }).click();
  await expect(page.getByRole('alert')).toContainText('нельзя напечатать в PDF');
  await expect(page.getByRole('alert')).toContainText('латиницей');
});
