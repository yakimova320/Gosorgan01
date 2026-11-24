import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { API_URL, createUser, letters } from './helpers';

/* F03: экран дела, письмо с объяснением, история (настоящий API, demo). */

const fixture = (name: string) =>
  resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name);
type Claim = { id: string; kind: string; status: string };

async function signedIn(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
}

/** Письмо через API: загрузить, подтвердить нужные факты, положить в новое дело. */
async function letterInCase(
  request: APIRequestContext,
  token: string,
  file: string,
  confirmAll: boolean,
) {
  const h = { Authorization: `Bearer ${token}` };
  const up = await request.post(`${API_URL}/letters`, {
    headers: h,
    multipart: {
      files: {
        name: file,
        mimeType: 'application/pdf',
        buffer: readFileSync(fixture(file)),
      },
    },
  });
  const body = (await up.json()) as { letter: { id: string }; claims: Claim[] };
  if (confirmAll)
    await request.post(`${API_URL}/letters/${body.letter.id}/claims/confirm`, {
      headers: h,
      data: { confirm: body.claims.map((c) => c.id) },
    });
  const assigned = await request.post(
    `${API_URL}/letters/${body.letter.id}/assign`,
    { headers: h, data: { newCase: {} } },
  );
  return {
    letterId: body.letter.id,
    caseId: ((await assigned.json()) as { caseId: string }).caseId,
    claims: body.claims,
  };
}

test('06: дело с двумя действующими сроками, письмо и объяснение со всеми сроками и основаниями', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'f03', `Anna${letters()}`);
  const { caseId, letterId } = await letterInCase(
    request,
    u.token,
    '06_multiple_deadlines.pdf',
    true,
  );
  await signedIn(page, u.token);

  await page.goto(`/app/cases/${caseId}`);
  await expect(page.getByTestId('deadline')).toHaveCount(2);
  for (const d of await page.getByTestId('deadline').all())
    await expect(d).toHaveAttribute('data-state', 'active');
  await expect(page.getByTestId('case-letter')).toHaveCount(1);

  await page.getByRole('link', { name: 'Объяснение' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/letters/${letterId}$`));
  await expect(page.getByTestId('explanation')).toContainText(
    'Finanzamt Beispielhausen',
  );
  // K08 (#133): что просит ведомство — по-русски и немецкий текст из письма
  const requests = page.getByTestId('request');
  await expect(requests).toHaveCount(2);
  await expect(requests.nth(0)).toContainText('Прислать: справки о доходах.');
  await expect(requests.nth(0)).toContainText('Bitte reichen Sie die Einkommensnachweise ein.');
  await expect(requests.nth(1)).toContainText('Подтвердить: ваш адрес.');
  await expect(requests.nth(1)).toContainText('Bitte bestätigen Sie Ihre Anschrift.');
  const deadlines = page.getByLabel('Сроки письма').getByTestId('deadline');
  await expect(deadlines).toHaveCount(2);
  await expect(deadlines.nth(0)).toContainText('01.12.2026');
  await expect(deadlines.nth(1)).toContainText('10.12.2026');
  await page.getByText('На чём основано').first().click();
  await expect(page.getByTestId('explanation')).toContainText('«');
});

test('изменение фактов → объяснение обновляется при открытии, без фоновых запросов', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'upd', `Anna${letters()}`);
  const { letterId } = await letterInCase(
    request,
    u.token,
    '01_jobcenter_request.pdf',
    false,
  );
  await signedIn(page, u.token);
  let explains = 0;
  page.on(
    'request',
    (r) => r.method() === 'POST' && r.url().includes('/explain') && explains++,
  );

  await page.goto(`/app/letters/${letterId}`);
  await expect(page.getByTestId('action').first()).toContainText(
    'Проверьте: факт ещё не подтверждён',
  );
  expect(explains).toBe(1);

  await page.getByRole('link', { name: 'Проверить факты' }).click();
  await expect(page.getByTestId('claim').first()).toBeVisible();
  for (const b of await page
    .getByRole('button', { name: 'Верно', exact: true })
    .all())
    await b.click();
  await page.getByRole('button', { name: /Сохранить проверку/ }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Проверка сохранена' }),
  ).toBeVisible();
  await page.waitForTimeout(500);
  expect(explains).toBe(1); // изменение фактов не запускает объяснение в фоне

  await page.goto(`/app/letters/${letterId}`);
  await expect(page.getByTestId('explanation')).toBeVisible();
  await expect(
    page.getByText('Проверьте: факт ещё не подтверждён'),
  ).toHaveCount(0);
  expect(explains).toBe(2);
});

test('состояния объяснения: DATES_NOT_VERIFIED, LLM_QUOTA, CLAIMS_CHANGED', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'err', `Anna${letters()}`);
  const { letterId } = await letterInCase(
    request,
    u.token,
    '01_jobcenter_request.pdf',
    true,
  );
  await signedIn(page, u.token);
  const url = `${API_URL}/letters/${letterId}/explain?lang=ru`;
  const reply = (status: number, code: string) => ({
    status,
    contentType: 'application/json',
    body: JSON.stringify({ code, message: code }),
  });

  await page.route(url, (r) => r.fulfill(reply(422, 'DATES_NOT_VERIFIED')));
  await page.goto(`/app/letters/${letterId}`);
  await expect(page.getByTestId('dates-not-verified')).toContainText(
    'Посмотрите срок в оригинале письма',
  );
  await expect(page.getByTestId('dates-not-verified')).toContainText(
    'Jobcenter Musterstadt',
  );
  await expect(page.getByTestId('explanation')).toHaveCount(0);
  await page.unroute(url);

  await page.route(url, (r) => r.fulfill(reply(503, 'LLM_QUOTA')));
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Попробовать ещё раз' }),
  ).toBeVisible();
  await page.unroute(url);
  await page.getByRole('button', { name: 'Попробовать ещё раз' }).click();
  await expect(page.getByTestId('explanation')).toBeVisible();

  // CLAIMS_CHANGED: старое скрыто, сначала перечитываются факты, потом объяснение
  const order: string[] = [];
  let first = true;
  await page.route(url, (r) => {
    order.push('explain');
    if (first) {
      first = false;
      return r.fulfill(reply(409, 'CLAIMS_CHANGED'));
    }
    return r.continue();
  });
  page.on(
    'request',
    (r) =>
      r.method() === 'GET' &&
      r.url() === `${API_URL}/letters/${letterId}` &&
      order.push('letter'),
  );
  // Первый запрос письма после перезагрузки медленный: конфликт приходит, пока он ещё идёт.
  // Его ответ мог быть собран до изменения фактов, поэтому нужен новый запрос письма.
  let slowLetter = true;
  await page.route(`${API_URL}/letters/${letterId}`, async (r) => {
    if (r.request().method() === 'GET' && slowLetter) {
      slowLetter = false;
      await new Promise((done) => setTimeout(done, 800));
    }
    return r.continue();
  });
  await page.reload();
  await expect(page.getByTestId('explanation')).toBeVisible();
  const afterConflict = order.slice(order.indexOf('explain') + 1);
  expect(afterConflict.slice(0, 2)).toEqual(['letter', 'explain']);
});

test('история: больше 30 событий без пропусков и повторов, смена фильтра сбрасывает список, «Дела» отдельно от писем (#124)', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'hist', `Anna${letters()}`);
  const h = { Authorization: `Bearer ${u.token}` };
  const { letterId, claims } = await letterInCase(
    request,
    u.token,
    '01_jobcenter_request.pdf',
    false,
  );
  let claimId = claims.find((c) => c.kind === 'AUTHORITY')!.id;
  for (let i = 0; i < 31; i++) {
    const res = await request.post(
      `${API_URL}/letters/${letterId}/claims/${claimId}/correct`,
      {
        headers: h,
        data: {
          value: `Jobcenter Musterstadt ${String.fromCharCode(65 + (i % 26))}${i}`,
        },
      },
    );
    claimId = (
      (await res.json()) as {
        claims: { id: string; supersedesId: string | null }[];
      }
    ).claims.find((c) => c.supersedesId === claimId)!.id;
  }
  const total = 33; // дело создано, письмо добавлено, 31 исправление
  await signedIn(page, u.token);
  await page.goto('/app/history');
  await expect(page.getByTestId('history-item')).toHaveCount(30);
  await page.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(total);
  await expect(page.getByRole('button', { name: 'Показать ещё' })).toHaveCount(
    0,
  );
  const titles = await page.getByTestId('history-item').allTextContents();
  expect(new Set(titles).size).toBeGreaterThan(1);

  await page.getByRole('button', { name: 'Вопросы' }).click();
  await expect(page.getByText('Событий пока нет.')).toBeVisible();
  await page.getByRole('button', { name: 'Письма' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(30);
  // #124: в «Письмах» нет «Дело создано из письма», оно в «Делах»; страницы без потерь и повторов
  await page.getByRole('button', { name: 'Показать ещё' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(total - 1);
  await expect(page.getByTestId('history-item').filter({ hasText: 'Дело создано из письма' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Дела', exact: true }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(1);
  await expect(page.getByTestId('history-item')).toContainText('Дело создано из письма');
  await page.getByRole('button', { name: 'Всё', exact: true }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(30);
  await page.getByRole('button', { name: 'Письма' }).click();
  await expect(page.getByTestId('history-item')).toHaveCount(30);

  // правка 18-11: ссылка — вся карточка; нажатие у правого края, далеко от названия дела
  const card = page.getByTestId('history-item').first();
  await expect(card).toHaveAttribute('href', /\/app\/cases\//);
  const box = (await card.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await card.click({ position: { x: box.width - 12, y: 8 } });
  await expect(page).toHaveURL(/\/app\/cases\/[^/]+$/);
});

test('поправка 24.11: у письма дата письма, а не загрузки; одно письмо удаляется, дело остаётся', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'del1', `Anna${letters()}`);
  const h = { Authorization: `Bearer ${u.token}` };
  const { caseId, claims } = await letterInCase(
    request,
    u.token,
    '01_jobcenter_request.pdf',
    false,
  );
  const date = claims.find((c) => c.kind === 'LETTER_DATE') as Claim & {
    value: string;
  };
  const [y, m, d] = date.value.split('-');
  const second = await letterInCase(request, u.token, '06_multiple_deadlines.pdf', false);
  await request.post(`${API_URL}/letters/${second.letterId}/assign`, {
    headers: h,
    data: { caseId },
  });
  // дата первого письма подтверждена, второго — нет
  const firstId = (
    (await (
      await request.get(`${API_URL}/cases/${caseId}`, { headers: h })
    ).json()) as { letters: { id: string }[] }
  ).letters.find((l) => l.id !== second.letterId)!.id;
  await request.post(`${API_URL}/letters/${firstId}/claims/confirm`, {
    headers: h,
    data: { confirm: [date.id], reject: [] },
  });
  await signedIn(page, u.token);
  await page.goto(`/app/cases/${caseId}`);

  const cards = page.getByTestId('case-letter');
  await expect(cards).toHaveCount(2);
  const dates = cards.getByTestId('letter-date');
  await expect(dates.filter({ hasText: /^от \d\d\.\d\d\.\d{4}$/ })).toHaveText(`от ${d}.${m}.${y}`);
  await expect(dates.filter({ hasText: 'не подтверждена' })).toHaveCount(1);

  const other = cards.filter({ hasText: 'дата не подтверждена' });
  await other.getByRole('button', { name: 'Удалить письмо' }).click();
  await other.getByRole('button', { name: 'Отмена' }).click();
  await expect(cards).toHaveCount(2);
  await other.getByRole('button', { name: 'Удалить письмо' }).click();
  await other.getByRole('button', { name: 'Удалить письмо безвозвратно' }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByTestId('letter-date')).toContainText(`${d}.${m}.${y}`);
  await page.reload();
  await expect(cards).toHaveCount(1);
  expect(
    (await request.get(`${API_URL}/letters/${second.letterId}`, { headers: h })).status(),
  ).toBe(404);
});

test('дело: завершить, открыть снова, удалить; чужое дело и письмо не показываются', async ({
  page,
  request,
}) => {
  const a = await createUser(request, 'own', `Anna${letters()}`);
  const b = await createUser(request, 'oth', `Bruno${letters()}`);
  const { caseId, letterId } = await letterInCase(
    request,
    a.token,
    '04_buergeramt.pdf',
    true,
  );

  await signedIn(page, b.token);
  await page.goto(`/app/cases/${caseId}`);
  await expect(
    page.getByRole('heading', { name: 'Дело не найдено' }),
  ).toBeVisible();
  await page.goto(`/app/letters/${letterId}`);
  await expect(
    page.getByRole('heading', { name: 'Письмо не найдено' }),
  ).toBeVisible();
  await expect(page.getByText('Bürgeramt')).toHaveCount(0);

  await signedIn(page, a.token);
  await page.goto(`/app/cases/${caseId}`);
  await page.getByRole('button', { name: 'Завершить дело' }).click();
  await expect(page.getByText('Завершено').first()).toBeVisible();
  await page.getByRole('button', { name: 'Открыть снова' }).click();
  await expect(
    page.getByRole('button', { name: 'Завершить дело' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Удалить дело' }).click();
  await page.getByRole('button', { name: 'Удалить безвозвратно' }).click();
  await expect(page).toHaveURL(/\/app\/cases$/);
  await expect(page.getByTestId('case-row')).toHaveCount(0);
  await page.goto(`/app/cases/${caseId}`);
  await expect(
    page.getByRole('heading', { name: 'Дело не найдено' }),
  ).toBeVisible();
});
