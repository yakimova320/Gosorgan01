import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { API_URL, createUser, letters } from './helpers';

/* F02: загрузка письма и проверка фактов на сайте, с настоящим API в режиме demo. */

const fixture = (name: string) =>
  resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name);

/** PDF с обычным текстом без фактов: demo-извлечение ничего не находит. */
function plainPdf(): Buffer {
  const text = 'Hallo und viele Gruesse aus dem Sommerurlaub am Meer';
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function signedIn(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
}

/** Загрузка через сайт: выбор файла → «Готово, читать письмо» → страница проверки. */
async function uploadUi(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
) {
  await page.goto('/app/scan');
  await page.getByTestId('file-input').setInputFiles(file);
  await expect(page).toHaveURL(/\/app\/scan\/pages$/);
  await page.getByRole('button', { name: 'Готово, читать письмо' }).click();
}

const claim = (page: Page, text: RegExp | string) =>
  page.getByTestId('claim').filter({ hasText: text });

test('PDF 01: факты с цитатами, решения сохраняются одним действием и переживают перезагрузку', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'f02', `Anna${letters()}`);
  await signedIn(page, u.token);
  await uploadUi(page, fixture('01_jobcenter_request.pdf'));
  await expect(page).toHaveURL(/\/app\/letters\/[^/]+\/check$/, {
    timeout: 30_000,
  });
  await expect(claim(page, 'Ведомство: Jobcenter Musterstadt')).toContainText(
    '«Jobcenter Musterstadt»',
  );
  await expect(page.getByTestId('deadline')).toContainText('Кандидат');

  await claim(page, 'Ведомство: ')
    .getByRole('button', { name: 'Верно', exact: true })
    .click();
  await claim(page, 'Номер дела: ')
    .getByRole('button', { name: 'Неверно' })
    .click();
  await claim(page, 'Срок: до')
    .getByRole('button', { name: 'Верно', exact: true })
    .click();
  // локальная отметка не делает срок действующим
  await expect(page.getByTestId('deadline')).toContainText('Кандидат');
  await page.getByRole('button', { name: /Сохранить проверку \(3\)/ }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Проверка сохранена' }),
  ).toBeVisible();

  await page.reload();
  await expect(claim(page, 'Ведомство: ')).toContainText('Подтверждено');
  await expect(claim(page, 'Номер дела: ')).toContainText('Отклонено');
  await expect(page.getByTestId('deadline')).toContainText('Действует');
});

test('исправление: решения по другим фактам остаются, исправленный факт без цитаты и не подтверждён', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'fix', `Anna${letters()}`);
  await signedIn(page, u.token);
  await uploadUi(page, fixture('06_multiple_deadlines.pdf'));
  await expect(page).toHaveURL(/\/check$/, { timeout: 30_000 });

  const authority = claim(page, 'Ведомство: ');
  await authority.getByRole('button', { name: 'Верно', exact: true }).click();
  const deadline = claim(page, 'до 01.12.2026');
  await deadline.getByRole('button', { name: 'Верно', exact: true }).click();
  await deadline.getByRole('button', { name: 'Исправить' }).click();
  await page.getByLabel('Верная дата (ТТ.ММ.ГГГГ)').fill('05.12.2026');
  await page.getByRole('button', { name: 'Сохранить исправление' }).click();

  const fixed = claim(page, 'исправлено вами');
  await expect(fixed).toContainText('Указано вами, цитаты из письма нет');
  await expect(fixed).toContainText('Исправлено вами');
  await expect(
    fixed.getByRole('button', { name: 'Верно', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(
    authority.getByRole('button', { name: 'Верно', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: /Сохранить проверку \(1\)/ }),
  ).toBeVisible();
  await expect(
    page.getByTestId('deadline').filter({ hasText: '05.12.2026' }),
  ).toContainText('Кандидат');
});

test('факты не найдены: отдельное понятное состояние, текст письма доступен', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'empty', `Anna${letters()}`);
  await signedIn(page, u.token);
  await uploadUi(page, {
    name: 'urlaub.pdf',
    mimeType: 'application/pdf',
    buffer: plainPdf(),
  });
  await expect(page.getByTestId('no-facts')).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('heading', { name: 'Факты не найдены' }),
  ).toBeVisible();
  await page.locator('summary', { hasText: 'Текст письма' }).click();
  await expect(page.getByText('Sommerurlaub')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('ошибки файла: нечитаемое фото и скан PDF — понятный текст и «Выбрать другой файл»', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'bad', `Anna${letters()}`);
  await signedIn(page, u.token);
  await uploadUi(page, fixture('11_bad_photo.jpg'));
  await expect(page.getByRole('alert')).toContainText('Фото размыто');
  await page.getByRole('button', { name: 'Выбрать другой файл' }).click();
  await expect(page).toHaveURL(/\/app\/scan$/);
  await uploadUi(page, fixture('09_scan.pdf'));
  await expect(page.getByRole('alert')).toContainText('Сфотографируйте письмо');
});

test('обрыв связи: POST не повторяется автоматически, предлагается проверить входящие', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'net', `Anna${letters()}`);
  await signedIn(page, u.token);
  let posts = 0;
  await page.route(`${API_URL}/letters`, (route) => {
    if (route.request().method() === 'POST') {
      posts++;
      return route.abort('connectionreset');
    }
    return route.continue();
  });
  await uploadUi(page, fixture('01_jobcenter_request.pdf'));
  await expect(page.getByTestId('upload-unknown')).toContainText(
    'Письмо могло успеть сохраниться',
  );
  await expect(
    page.getByRole('button', { name: 'Попробовать ещё раз' }),
  ).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(posts).toBe(1);
});

test('двойной клик: один запрос и одно письмо', async ({ page, request }) => {
  const u = await createUser(request, 'dbl', `Anna${letters()}`);
  await signedIn(page, u.token);
  let posts = 0;
  page.on(
    'request',
    (r) => r.method() === 'POST' && r.url() === `${API_URL}/letters` && posts++,
  );
  await page.goto('/app/scan');
  await page
    .getByTestId('file-input')
    .setInputFiles(fixture('01_jobcenter_request.pdf'));
  await page.getByRole('button', { name: 'Готово, читать письмо' }).dblclick();
  await expect(page).toHaveURL(/\/check$/, { timeout: 30_000 });
  expect(posts).toBe(1);
  const inbox = await request.get(`${API_URL}/letters`, {
    headers: { Authorization: `Bearer ${u.token}` },
  });
  expect(await inbox.json()).toHaveLength(1);
});

test('доступ: чужое письмо не показывается, истёкшая сессия ведёт на вход', async ({
  page,
  request,
}) => {
  const a = await createUser(request, 'owner', `Anna${letters()}`);
  const b = await createUser(request, 'other', `Bruno${letters()}`);
  const up = await request.post(`${API_URL}/letters`, {
    headers: { Authorization: `Bearer ${a.token}` },
    multipart: {
      files: {
        name: 'a.pdf',
        mimeType: 'application/pdf',
        buffer: (await import('node:fs')).readFileSync(
          fixture('04_buergeramt.pdf'),
        ),
      },
    },
  });
  const id = (await up.json()).letter.id as string;

  await signedIn(page, b.token);
  await page.goto(`/app/letters/${id}/check`);
  await expect(
    page.getByRole('heading', { name: 'Письмо не найдено' }),
  ).toBeVisible();
  await expect(page.getByText('Bürgeramt')).toHaveCount(0);

  await signedIn(page, a.token);
  await page.goto(`/app/letters/${id}/check`); // прямое открытие
  await expect(claim(page, 'Ведомство: ')).toContainText('Bürgeramt');

  await page.evaluate(() =>
    localStorage.setItem('jasno.session', 'abgelaufen'),
  );
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Bürgeramt')).toHaveCount(0);
});

test('уход с несохранёнными решениями предупреждает; «Оставить во входящих» и удаление', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'leave', `Anna${letters()}`);
  await signedIn(page, u.token);
  await uploadUi(page, fixture('01_jobcenter_request.pdf'));
  await expect(page).toHaveURL(/\/check$/, { timeout: 30_000 });
  const url = page.url();

  await claim(page, 'Ведомство: ')
    .getByRole('button', { name: 'Верно', exact: true })
    .click();
  await page.getByRole('button', { name: 'Оставить во входящих' }).click();
  await expect(
    page.getByRole('alertdialog', { name: 'Несохранённые решения' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Остаться' }).click();
  await expect(page).toHaveURL(url);

  await page.getByRole('button', { name: 'Сохранить проверку (1)' }).click();
  await page.getByRole('button', { name: 'Оставить во входящих' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByTestId('inbox-letter')).toHaveCount(1);

  await page.getByTestId('inbox-letter').click();
  await page.getByRole('button', { name: 'Удалить письмо' }).click();
  await page.getByRole('button', { name: 'Удалить безвозвратно' }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(
    page.getByRole('heading', { name: 'Здесь пока тихо' }),
  ).toBeVisible();
});
