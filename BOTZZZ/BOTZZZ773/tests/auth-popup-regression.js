const { chromium } = require('playwright');

const BASE_URL = process.env.BOTZZZ_TEST_ORIGIN || 'https://www.botzzz773.pro/';

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[TEST] Starting popup auth verification...');
    await page.goto(new URL('index.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    const popupPromise = context.waitForEvent('page');
    await Promise.all([
      popupPromise,
      page.click('a:has-text("Sign In")')
    ]);
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');

    console.log('[TEST] Popup opened, simulating successful login...');
    await popup.evaluate(() => {
      window.opener?.postMessage({
        type: 'USER_LOGGED_IN',
        user: { username: 'playwright-user' },
        token: 'playwright-token'
      }, window.location.origin);
      window.close();
    });

    await page.waitForFunction(() => localStorage.getItem('token') === 'playwright-token', null, { timeout: 5000 });
    console.log('[TEST] Parent window stored auth payload.');

    const navSelector = '#authNavItem .nav-link';
    await page.waitForSelector(navSelector, { timeout: 3000 });
    const navText = await page.textContent(navSelector);
    if (!navText || !navText.toLowerCase().includes('playwright')) {
      throw new Error('Navigation did not refresh with new username.');
    }
    console.log('[TEST] Navigation updated with popup event.');

    console.log('[TEST] Starting fallback navigation verification...');
    await page.goto(new URL('index.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
      window.__originalOpen = window.open;
      window.open = () => null;
    });

    const [response] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('a:has-text("Sign In")')
    ]);
    if (!response) {
      throw new Error('Fallback navigation did not occur when window.open returned null.');
    }

    const currentUrl = page.url();
    if (!currentUrl.includes('signin.html')) {
      throw new Error('Fallback navigation did not land on signin.html');
    }
    if (!currentUrl.includes('redirect=')) {
      throw new Error('Fallback signin URL missing redirect parameter.');
    }

    console.log('[TEST] Fallback navigation verified.');
    await page.evaluate(() => {
      if (window.__originalOpen) {
        window.open = window.__originalOpen;
      }
    });

    console.log('[TEST] Auth popup regression suite completed successfully.');
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
