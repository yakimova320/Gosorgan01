import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { API_URL, createUser, letters, signedIn } from './helpers';

/*
 * E01 (#163): ключ архива в браузере. Секрет создаётся на экране «Ключ вашего архива»;
 * на новом устройстве архив открывается только им; открытый текст письма и ключи
 * не попадают в localStorage, sessionStorage и сетевые GET-запросы.
 * JASNO_SHOTS=1: скриншоты 390 и 1440 px в docs/screenshots/e01.
 */

const fixture = (name: string) => resolve(import.meta.dirname, '..', '..', 'fixtures', 'letters', name);
const SHOTS = resolve(import.meta.dirname, '..', '..', 'docs', 'screenshots', 'e01');

async function shot(page: Page, name: string) {
  if (!process.env.JASNO_SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.screenshot({ path: resolve(SHOTS, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('ключ архива: секрет показан до первой загрузки, письмо открывается, на новом устройстве нужен секрет', async ({
  page,
  browser,
  request,
}) => {
  const u = await createUser(request, 'vault', `Anna${letters()}`);
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), u.token);
  await page.goto('/app');
  await expect(page.getByRole('heading', { name: 'Ключ вашего архива' })).toBeVisible();
  await expect(page.getByText('письма будут потеряны навсегда')).toBeVisible();
  // без отметки «сохранил(а)» ключ не создаётся
  await expect(page.getByRole('button', { name: 'Создать ключ архива' })).toBeDisabled();
  await shot(page, 'setup');
  const secret = (await page.getByTestId('recovery-secret').textContent())!.trim();
  expect(secret).toMatch(/^([0-9A-Z]{4}-){13}[0-9A-Z]{3}$/);
  await page.getByRole('checkbox', { name: /сохранил\(а\) секрет/ }).check();
  await page.getByRole('button', { name: 'Создать ключ архива' }).click();
  await expect(page.getByTestId('vault-open')).toBeAttached();

  // письмо: GET-ответы — шифротекст, на экране — открытый текст
  const gets: string[] = [];
  page.on('response', async (r) => {
    if (r.request().method() === 'GET' && r.url().includes('/letters/') && r.headers()['content-type']?.includes('json'))
      gets.push(await r.text().catch(() => ''));
  });
  await page.goto('/app/scan');
  await page.getByTestId('file-input').setInputFiles(fixture('01_jobcenter_request.pdf'));
  await page.getByRole('button', { name: 'Готово, читать письмо' }).click();
  await expect(page).toHaveURL(/\/app\/letters\/[^/]+\/check$/, { timeout: 30_000 });
  const letterUrl = page.url();
  await page.reload();
  await expect(page.getByTestId('claim').filter({ hasText: 'Ведомство: Jobcenter Musterstadt' })).toBeVisible();
  const bodies = gets.filter(Boolean); // тело ответа, прерванного перезагрузкой, недоступно
  expect(bodies.some((b) => b.includes('jx1.'))).toBe(true);
  for (const body of bodies) expect(body).not.toContain('Musterstadt');
  // хранилище браузера: ни текста письма, ни секрета
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage }),
  );
  expect(stored).not.toContain('Musterstadt');
  expect(stored).not.toContain(secret);

  // «новое устройство»: другой контекст браузера, тот же вход
  const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const phone = await other.newPage();
  await signedInOnly(phone, u.token);
  await phone.goto(letterUrl);
  await expect(phone.getByRole('heading', { name: 'Откройте архив' })).toBeVisible();
  await phone.getByLabel('Секрет восстановления').fill(`${secret.slice(0, -1)}${secret.endsWith('0') ? '1' : '0'}`);
  await phone.getByRole('button', { name: 'Открыть архив' }).click();
  await expect(phone.getByText('Секрет не подходит')).toBeVisible();
  await shot(phone, 'unlock');
  await phone.getByLabel('Секрет восстановления').fill(secret.toLowerCase().replace(/-/g, ' '));
  await phone.getByRole('button', { name: 'Открыть архив' }).click();
  await expect(phone.getByTestId('claim').filter({ hasText: 'Ведомство: Jobcenter Musterstadt' })).toBeVisible();
  // устройство помнит ключ: после перезагрузки секрет не нужен
  await phone.reload();
  await expect(phone.getByTestId('claim').filter({ hasText: 'Ведомство: Jobcenter Musterstadt' })).toBeVisible();
  await other.close();
});

test('второй вход на том же устройстве: архив открыт без секрета', async ({ page, request }) => {
  const u = await createUser(request, 'vault2', `Anna${letters()}`);
  expect(await signedIn(page, u.token)).toMatch(/-/);
  expect(await signedIn(page, u.token)).toBeNull();
});

test('E02 (#165): после открытия архива «Ваш следующий шаг» показывает название дела, не шифротекст', async ({
  page,
  request,
}) => {
  const u = await createUser(request, 'vault-next', `Anna${letters()}`);
  const h = { Authorization: `Bearer ${u.token}` };
  const up = await request.post(`${API_URL}/letters`, {
    headers: h,
    multipart: {
      files: { name: '04_buergeramt.pdf', mimeType: 'application/pdf', buffer: readFileSync(fixture('04_buergeramt.pdf')) },
    },
  });
  expect(up.status()).toBe(201);
  const body = (await up.json()) as { letter: { id: string }; claims: { id: string }[] };
  await request.post(`${API_URL}/letters/${body.letter.id}/claims/confirm`, {
    headers: h,
    data: { confirm: body.claims.map((c) => c.id) },
  });
  const assigned = await request.post(`${API_URL}/letters/${body.letter.id}/assign`, {
    headers: h,
    data: { newCase: {} },
  });
  expect(assigned.ok()).toBe(true);
  const caseId = ((await assigned.json()) as { caseId: string }).caseId;
  const kase = (await (await request.get(`${API_URL}/cases/${caseId}`, { headers: h })).json()) as {
    case?: { title: string };
    title?: string;
  };
  const title = kase.case?.title ?? kase.title!;
  expect(title).not.toMatch(/^jx1\./);

  // новое устройство: данные кабинета запрашиваются ещё до ввода секрета
  await signedIn(page, u.token);
  const next = page.getByRole('link', { name: /Ваш следующий шаг/ });
  await expect(next).toContainText(title);
  await expect(next).not.toContainText('jx1.');
});

async function signedInOnly(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('jasno.session', t), token);
}
