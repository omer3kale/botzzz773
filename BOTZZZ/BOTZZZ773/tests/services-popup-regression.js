const { chromium } = require('playwright');

const BASE_URL = process.env.BOTZZZ_TEST_ORIGIN || 'https://www.botzzz773.pro/';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[TEST] Starting services popup verification...');
    await page.goto(new URL('index.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('token', 'playwright-services-token');
      localStorage.setItem('user', JSON.stringify({ username: 'services-user' }));
      sessionStorage.clear();
      if (window.__originalOpen) {
        window.open = window.__originalOpen;
        delete window.__originalOpen;
      }
    });

    const popupPromise = context.waitForEvent('page');
    await Promise.all([
      popupPromise,
      page.click('nav .nav-link:has-text("Services")')
    ]);
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');

    const popupUrl = popup.url();
    if (!popupUrl.includes('services.html') || !popupUrl.includes('popup=1')) {
      throw new Error('Services popup URL missing popup parameter.');
    }

    const popupModeEnabled = await popup.evaluate(() => document.body.classList.contains('popup-mode'));
    if (!popupModeEnabled) {
      throw new Error('Services popup did not enable popup-mode styling.');
    }

    await popup.close();
    console.log('[TEST] Services popup launch verified.');

    console.log('[TEST] Starting services fallback navigation verification...');
    await page.goto(new URL('index.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.setItem('token', 'playwright-services-token');
      localStorage.setItem('user', JSON.stringify({ username: 'services-user' }));
      sessionStorage.clear();
      window.__originalOpen = window.open;
      window.open = () => null;
    });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('nav .nav-link:has-text("Services")')
    ]);

    const fallbackUrl = page.url();
    if (!fallbackUrl.includes('services.html')) {
      throw new Error('Fallback navigation did not reach services.html when popup was blocked.');
    }

    await page.evaluate(() => {
      if (window.__originalOpen) {
        window.open = window.__originalOpen;
        delete window.__originalOpen;
      }
    });
    console.log('[TEST] Services fallback navigation verified.');

    console.log('[TEST] Services popup regression completed successfully.');
  } catch (error) {
    console.error('[TEST] Failure:', error.message || error);
    console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
  }
}

run();
