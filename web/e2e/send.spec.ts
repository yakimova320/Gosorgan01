import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { test } from './fixtures';
import { API_URL, createUser, letters, signedIn } from './helpers';

/*
 * B12: виды ответа, правка черновика с повторной проверкой, «Я отправил(а)», срок выполнен, «В Google Календарь».
 * Настоящий API (demo). Письмо собирается со сроком «сегодня + 20 дней», чтобы тест не устаревал.
 */

const de = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`;
const inDays = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

/** Текстовый PDF письма: строки, которые понимает demo-извлечение. */
function letterPdf(deadline: string): Buffer {
  const lines = [
    'Jobcenter Musterstadt',
    `Datum: ${de(inDays(-3))}`,
    'Aktenzeichen: JC-2026-7777',
    'Bitte reichen Sie die Kontoauszuege ein.',
    `Bitte antworten Sie bis zum ${deadline}.`,
  ];
  const content = lines.map((l, i) => `BT /F1 12 Tf 72 ${720 - i * 20} Td (${l}) Tj ET`).join('\n');
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


/** Письмо с подтверждёнными фактами в новом деле. */
async function caseWithLetter(request: APIRequestContext, token: string, deadline: string) {
  const h = { Authorization: `Bearer ${token}` };
  const up = await (
    await request.post(`${API_URL}/letters`, {
      headers: h,
      multipart: { files: { name: 'a.pdf', mimeType: 'application/pdf', buffer: letterPdf(deadline) } },
    })
  ).json();
  await request.post(`${API_URL}/letters/${up.letter.id}/claims/confirm`, {
    headers: h,
    data: { confirm: (up.claims as { id: string }[]).map((c) => c.id) },
  });
  const { caseId } = await (
    await request.post(`${API_URL}/letters/${up.letter.id}/assign`, { headers: h, data: { newCase: {} } })
  ).json();
  return { h, caseId: caseId as string, letterId: up.letter.id as string };
}

test('продлить срок: черновик, правка с проверкой, «Я отправил(а)» с закрытием срока', async ({ page, request }) => {
  const deadline = de(inDays(20));
  const u = await createUser(request, 'send', `Anna${letters()}`);
  const { h, caseId } = await caseWithLetter(request, u.token, deadline);
  await signedIn(page, u.token);

  await page.goto(`/app/cases/${caseId}/answer`);
  for (const k of ['CLARIFICATION', 'DOCUMENTS', 'EXTENSION', 'STATUS_REQUEST'])
    await expect(page.getByTestId(`kind-${k}`)).toBeEnabled();
  await page.getByTestId('kind-EXTENSION').click();
  await expect(page.getByText(`Срок в письме: до ${deadline}.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Собрать черновик' })).toBeDisabled();
  await page.getByTestId('reason').filter({ hasText: 'консультацию' }).click();
  await page.getByRole('button', { name: 'Собрать черновик' }).click();
  await expect(page.getByTestId('german-text')).toContainText(`Frist bis zum ${deadline} gesetzt.`);
  await expect(page.getByTestId('german-text')).toContainText('Ich möchte mich vorher beraten lassen.');

  // правка: чужая дата не проходит проверку, текст не сохраняется
  await page.getByRole('button', { name: 'Изменить текст' }).click();
  const german = page.getByLabel('Текст на немецком');
  const original = await german.inputValue();
  await german.fill(original.replace('Vielen Dank im Voraus.', 'Ich antworte bis zum 24.12.2099.\n\nVielen Dank im Voraus.'));
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await expect(page.getByTestId('draft-error')).toContainText('не из источников');
  await german.fill(original.replace('Vielen Dank im Voraus.', 'Ich bin telefonisch erreichbar.\n\nVielen Dank im Voraus.'));
  await page.getByRole('button', { name: 'Проверить и сохранить' }).click();
  await expect(page.getByTestId('draft-editor')).toHaveCount(0);
  await expect(page.getByText('Текст изменён вами и проверен заново')).toBeVisible();
  await expect(page.getByTestId('german-text')).toContainText('Ich bin telefonisch erreichbar.');
  const draftId = new URL(page.url()).searchParams.get('draft')!;

  // «Я отправил(а)»: ошибки у полей, срок закрывается только по выбору
  await page.getByRole('link', { name: 'Я отправил(а)' }).click();
  const form = page.getByTestId('sent-form');
  await form.getByRole('button', { name: 'Я отправил(а)' }).click();
  await expect(form.getByText('Выберите, как вы отправили')).toBeVisible();
  await form.getByLabel('Почтой').check();
  await form.getByLabel('Когда (ТТ.ММ.ГГГГ)').fill(de(inDays(2)));
  await form.getByLabel('Когда (ТТ.ММ.ГГГГ)').blur();
  await expect(form.getByText('Дата отправки не может быть в будущем')).toBeVisible();
  await form.getByLabel('Когда (ТТ.ММ.ГГГГ)').fill(de(inDays(-1)).replace(/\./g, ','));
  await expect(form.getByLabel('Нет, срок не закрывать')).toBeChecked();
  await form.getByLabel(`Срок до ${deadline} выполнен`).check();
  await form.getByRole('button', { name: 'Я отправил(а)' }).click();
  await expect(page).toHaveURL(/\/app\/done$/);

  const draft = await (await request.get(`${API_URL}/drafts/${draftId}`, { headers: h })).json();
  expect(draft).toMatchObject({ status: 'SENT', sentVia: 'post', edited: true });
  await page.goto(`/app/cases/${caseId}`);
  await expect(page.getByTestId('deadline').first()).toHaveAttribute('data-state', 'done');
  await expect(page.getByText('Вы отметили: ответ отправлен')).toBeVisible();
});

test('срок на странице дела: выполнено и снова открыт; «В Google Календарь» открывает готовое событие', async ({ page, request }) => {
  const deadline = de(inDays(15));
  const u = await createUser(request, 'gcal', `Anna${letters()}`);
  const { caseId } = await caseWithLetter(request, u.token, deadline);
  await signedIn(page, u.token);
  await page.goto(`/app/cases/${caseId}`);

  const link = page.getByRole('link', { name: 'В Google Календарь' });
  await expect(link).toHaveAttribute('target', '_blank');
  const url = new URL((await link.getAttribute('href'))!);
  expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
  expect(url.searchParams.get('action')).toBe('TEMPLATE');
  expect(url.searchParams.get('dates')).toMatch(new RegExp(`^${deadline.split('.').reverse().join('')}/\\d{8}$`));
  expect(url.searchParams.get('text')).toMatch(/^Срок/);
  expect(url.searchParams.get('details')).toContain(`/app/cases/${caseId}`);

  // тот же срок в кабинете, блок «Календарь и напоминания»
  await page.goto('/app');
  const item = page.getByTestId('calendar-profile').getByTestId('calendar-deadline');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(deadline);
  const fromCabinet = new URL((await item.getByRole('link', { name: 'В Google Календарь' }).getAttribute('href'))!);
  expect(fromCabinet.searchParams.get('dates')).toBe(url.searchParams.get('dates'));
  expect(fromCabinet.searchParams.get('text')).toContain('Jobcenter');
  await page.goto(`/app/cases/${caseId}`);

  await page.getByRole('button', { name: 'Выполнено' }).click();
  await expect(page.getByTestId('deadline').first()).toHaveAttribute('data-state', 'done');
  await expect(page.getByRole('link', { name: 'В Google Календарь' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Открыть срок снова' }).click();
  await expect(page.getByTestId('deadline').first()).toHaveAttribute('data-state', 'active');
});
