import { expect, type Page } from '@playwright/test';
import { test } from './fixtures';
import { chooseLang, createUser, letters, signedIn } from './helpers';

/*
 * UX 27.11 (#172): картинки тем, тарифы, «Сложный случай?», «Формуляры», подвал.
 * Настоящий API (demo).
 */

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('главная: картинки тем по id, без alt; на 390 px сетка 2×2; файлы до 150 КБ', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const cards = page.getByTestId('home-topics').locator('.topic-card');
  await expect(cards).toHaveCount(4);
  const files: Record<string, string> = { children: 'family', housing: 'living', insurance: 'ensurance', health: 'health' };
  for (const [topic, file] of Object.entries(files)) {
    const img = page.locator(`.topic-card[data-topic="${topic}"] img`);
    await expect(img).toHaveAttribute('src', `/illustrations/${file}.webp`);
    await expect(img).toHaveAttribute('alt', '');
    const res = await request.get(`${page.url().replace(/\/$/, '')}/illustrations/${file}.webp`);
    expect((await res.body()).length).toBeLessThanOrEqual(150_000);
  }
  const [a, b, c] = await Promise.all([0, 1, 2].map((i) => cards.nth(i).boundingBox()));
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2); // две в ряд
  expect(c!.y).toBeGreaterThan(a!.y + a!.height - 1); // третья ниже
  await expect(cards.first().getByRole('heading')).toBeVisible();
  expect(await noHScroll(page)).toBe(true);
});

test('тарифы: /#preise, три карточки, «в месяц» и «скоро» только у платных, без кнопок оплаты', async ({ page }) => {
  await page.goto('/#preise');
  const prices = page.getByTestId('prices');
  await expect(prices).toBeInViewport();
  await expect(prices.getByRole('heading', { name: 'Тарифы' })).toBeVisible();
  const plan = (id: string) => prices.locator(`[data-plan="${id}"]`);
  await expect(plan('start')).toContainText('Старт');
  await expect(plan('start')).toContainText('0 €');
  await expect(plan('start')).toContainText('Хранение писем, 3 разбора в месяц, календарь и напоминания.');
  await expect(plan('start').locator('.price__per, .price__soon')).toHaveCount(0);
  await expect(plan('plus')).toContainText('4,99 € в месяц');
  await expect(plan('family')).toContainText('12,99 € в месяц');
  for (const id of ['plus', 'family']) await expect(plan(id).locator('.price__soon')).toHaveText('скоро');
  await expect(prices.getByRole('button')).toHaveCount(0);
  await expect(prices.getByRole('link')).toHaveCount(0);
  await expect(prices.getByText('Тестовая версия бесплатная.')).toBeVisible();

  // 1440: в ряд, средняя выше; 390: друг под другом
  const box = async (id: string) => (await plan(id).boundingBox())!;
  const [s, p, f] = [await box('start'), await box('plus'), await box('family')];
  expect(p.x).toBeGreaterThan(s.x + s.width - 1);
  expect(f.x).toBeGreaterThan(p.x + p.width - 1);
  expect(p.y).toBeLessThan(s.y);
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await box('plus')).y).toBeGreaterThan((await box('start')).y + 40);
  expect(await noHScroll(page)).toBe(true);

  await chooseLang(page, 'de');
  await expect(prices.getByRole('heading', { name: 'Preise' })).toBeVisible();
  await expect(plan('plus')).toContainText('4,99 € im Monat');
  await expect(plan('family')).toContainText('Familie');
  await expect(plan('family').locator('.price__soon')).toHaveText('bald');
});

test('«Сложный случай?»: от 768 px текст слева, рисунок справа; уже — одна колонка', async ({ page }) => {
  await page.goto('/');
  const block = page.getByTestId('consult');
  const title = block.getByRole('heading', { name: 'Сложный случай? Подскажем, куда обратиться' });
  const art = block.locator('.consult__art img');
  for (const [width, twoCols] of [[1440, true], [768, true], [390, false]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await block.scrollIntoViewIfNeeded();
    const t = (await title.boundingBox())!;
    const a = (await art.boundingBox())!;
    if (twoCols) expect(a.x).toBeGreaterThan(t.x + t.width - 1);
    else expect(a.y).toBeGreaterThan(t.y + t.height - 1);
    expect(parseFloat(await title.evaluate((e) => getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(28);
    expect(a.height).toBeGreaterThan(190);
    await expect(block.getByRole('link', { name: 'Найти консультацию' })).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
  }
});

test('«Формуляры»: в публичном меню и в меню кабинета, страница с пометкой «скоро»', async ({ page, request }) => {
  await page.goto('/faq');
  await page.getByTestId('public-menu-button').click();
  await page.getByTestId('public-menu').getByRole('link', { name: 'Формуляры' }).click();
  await expect(page).toHaveURL(/\/formulare$/);
  await expect(page.getByRole('heading', { name: 'Формуляры', level: 1 })).toBeVisible();
  await expect(page.getByTestId('formulare-soon')).toContainText('Скоро здесь появится помощник по заполнению формуляров.');
  await chooseLang(page, 'de');
  await expect(page.getByRole('heading', { name: 'Formulare', level: 1 })).toBeVisible();
  await expect(page.getByTestId('formulare-soon')).toContainText('Bald hilft Ihnen hier ein Assistent');

  await page.setViewportSize({ width: 390, height: 844 });
  const u = await createUser(request, 'k2711', `Anna${letters()}`);
  await signedIn(page, u.token);
  await page.goto('/app');
  await page.getByTestId('cabinet-menu-button').click();
  await page.getByTestId('cabinet-menu').getByRole('link', { name: 'Формуляры' }).click();
  await expect(page).toHaveURL(/\/formulare$/);
  expect(await noHScroll(page)).toBe(true);
});

test('подвал: две колонки рядом по левому краю, дисклеймер под ними, «Тарифы» ведёт на /#preise', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/faq');
    const footer = page.getByTestId('site-footer');
    const groups = footer.locator('.footer__group');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0).getByRole('link')).toHaveText(['Impressum', 'Datenschutz', 'AGB']);
    await expect(groups.nth(1).getByRole('link')).toHaveText([
      'Главная страница', 'Блог', 'FAQ', 'Глоссарий', 'Как это работает?', 'Тарифы',
    ]);
    await page.waitForLoadState('networkidle');
    // один снимок разметки: пока страница догружается, подвал может сдвигаться между замерами
    const m = await footer.evaluate((f) => {
      const r = (el: Element) => el.getBoundingClientRect();
      const [g1, g2] = [...f.querySelectorAll('.footer__group')].map(r);
      const links = [...f.querySelectorAll('.footer__group')[1].querySelectorAll('a')].map(r);
      return {
        g1, g2, links,
        inner: r(f.querySelector('.footer__inner')!),
        note: r(f.querySelector('.footer__note')!),
        border: getComputedStyle(f.querySelectorAll('.footer__group')[1]).borderTopWidth,
      };
    });
    expect(Math.abs(m.g1.y - m.g2.y)).toBeLessThan(2); // рядом
    expect(m.g2.x).toBeGreaterThan(m.g1.x + m.g1.width - 1);
    expect(m.g1.x - m.inner.x).toBeLessThan(2); // прижаты влево
    expect(m.g2.x + m.g2.width).toBeLessThan(m.inner.x + m.inner.width * 0.75);
    // ссылки столбиком, по левому краю, высота клика ≥ 44 px
    expect(m.links[1].y).toBeGreaterThan(m.links[0].y);
    expect(Math.abs(m.links[1].x - m.links[0].x)).toBeLessThan(1);
    expect(m.links[0].height).toBeGreaterThanOrEqual(44);
    expect(m.border).toBe('0px'); // линии между группами нет
    // дисклеймер под обеими колонками на всю ширину
    expect(m.note.y).toBeGreaterThan(Math.max(m.g1.y + m.g1.height, m.g2.y + m.g2.height) - 1);
    expect(m.note.width).toBeGreaterThan(m.inner.width - 2);
    // плавающая кнопка чата не закрывает ссылки подвала
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const fab = (await page.getByTestId('chat-launcher').boundingBox())!;
    for (const link of await footer.getByRole('link').all()) {
      const r = (await link.boundingBox())!;
      const overlap = r.x < fab.x + fab.width && fab.x < r.x + r.width && r.y < fab.y + fab.height && fab.y < r.y + r.height;
      expect(overlap, await link.innerText()).toBe(false);
    }
    expect(await noHScroll(page)).toBe(true);
  }
  await page.getByTestId('site-footer').getByRole('link', { name: 'Тарифы' }).click();
  await expect(page).toHaveURL(/\/#preise$/);
  await expect(page.getByTestId('prices')).toBeInViewport();
});

test('без горизонтальной прокрутки на 390, 768, 1280, 1440 px', async ({ page }) => {
  for (const width of [390, 768, 1280, 1440])
    for (const url of ['/', '/formulare']) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await page.getByTestId('site-footer').waitFor();
      expect(await noHScroll(page), `${url} @ ${width}`).toBe(true);
    }
});

test('FAQ: цена и лимит совпадают с тарифами на главной (RU и DE)', async ({ page }) => {
  await page.goto('/faq');
  await page.getByText('Сколько стоит Ja!sno?').click();
  await expect(page.getByText('Ja!sno Plus: 4,99 € в месяц. Разборы без лимита, архив, экспорт.')).toBeVisible();
  await expect(page.getByText('Цена после запуска: не решено')).toHaveCount(0);
  await page.getByText('Есть ли ограничение на число писем?').click();
  await expect(page.getByText(/в тарифе «Старт» будет 3 разбора в месяц/)).toBeVisible();
  await chooseLang(page, 'de');
  await page.getByText('Was kostet Ja!sno?').click();
  await expect(page.getByText('Familie: 12,99 € im Monat. Ein Konto für mehrere Personen.')).toBeVisible();
});
