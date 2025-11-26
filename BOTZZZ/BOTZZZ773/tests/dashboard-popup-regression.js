const { chromium } = require('playwright');

const BASE_URL = process.env.BOTZZZ_TEST_ORIGIN || 'https://www.botzzz773.pro/';

async function prepareDashboardNav(page, blockPopups = false) {
  await page.goto(new URL('index.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('token', 'playwright-dashboard-token');
    localStorage.setItem('user', JSON.stringify({ username: 'dashboard-user' }));
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav #authNavItem a[href="dashboard.html"]', { timeout: 5000 });

  await page.evaluate((shouldBlock) => {
    if (shouldBlock) {
      window.__originalOpen = window.open;
      window.open = () => null;
    } else if (window.__originalOpen) {
      window.open = window.__originalOpen;
      delete window.__originalOpen;
    }
  }, blockPopups);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[TEST] Starting dashboard popup verification...');
    await prepareDashboardNav(page, false);

    const popupPromise = context.waitForEvent('page');
    await Promise.all([
      popupPromise,
      page.click('nav #authNavItem a[href="dashboard.html"]')
    ]);
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');

    const popupUrl = popup.url();
    if (!popupUrl.includes('dashboard.html') || !popupUrl.includes('popup=1')) {
      throw new Error('Dashboard popup URL missing popup parameter.');
    }

    const popupModeEnabled = await popup.evaluate(() => document.body.classList.contains('popup-mode'));
    if (!popupModeEnabled) {
      throw new Error('Dashboard popup did not enable popup-mode styling.');
    }

    await popup.close();
    console.log('[TEST] Dashboard popup launch verified.');

    console.log('[TEST] Starting dashboard fallback navigation verification...');
    await prepareDashboardNav(page, true);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('nav #authNavItem a[href="dashboard.html"]')
    ]);

    const fallbackUrl = page.url();
    if (!fallbackUrl.includes('dashboard.html')) {
      throw new Error('Fallback navigation did not reach dashboard.html when popup was blocked.');
    }

    await page.evaluate(() => {
      if (window.__originalOpen) {
        window.open = window.__originalOpen;
        delete window.__originalOpen;
      }
    });
    console.log('[TEST] Dashboard fallback navigation verified.');

    console.log('[TEST] Dashboard popup regression completed successfully.');
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
