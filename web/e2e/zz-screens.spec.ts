import { test } from './fixtures';
import { createUser, letters, signedIn } from './helpers';

// временно: скриншоты для PR (#168), файл удаляется после съёмки
const OUT = '../docs/screenshots/ux-2611';
test.skip(!process.env.SCREENS, 'только для съёмки');

test('скриншоты', async ({ page, request }) => {
  test.setTimeout(120_000);
  for (const w of [390, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/');
    await page.getByTestId('lang-switcher').waitFor();
    await page.screenshot({ path: `${OUT}/start-${w}.png`, fullPage: true });
    await page.getByTestId('public-menu-button').click();
    await page.screenshot({ path: `${OUT}/start-menu-${w}.png` });
    await page.keyboard.press('Escape');
    await page.getByTestId('lang-switcher').click();
    await page.screenshot({ path: `${OUT}/lang-${w}.png` });
    await page.keyboard.press('Escape');
    await page.getByTestId('chat-launcher').click();
    await page.screenshot({ path: `${OUT}/chat-${w}.png` });
    await page.keyboard.press('Escape');
    await page.goto('/blog');
    await page.screenshot({ path: `${OUT}/blog-${w}.png`, fullPage: true });
    await page.goto('/agb');
    await page.screenshot({ path: `${OUT}/agb-${w}.png`, fullPage: true });
  }
  const u = await createUser(request, 'shots', `Anna${letters()}`);
  await signedIn(page, u.token);
  for (const w of [390, 1280]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/app');
    await page.locator('.app-main main').waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/cabinet-${w}.png`, fullPage: true });
    if (w === 390) {
      await page.getByTestId('cabinet-menu-button').click();
      await page.screenshot({ path: `${OUT}/cabinet-menu-${w}.png` });
    }
  }
});
