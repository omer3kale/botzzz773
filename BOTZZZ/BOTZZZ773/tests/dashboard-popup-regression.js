const { chromium } = require('playwright');

const BASE_URL = process.env.BOTZZZ_TEST_ORIGIN || 'https://www.botzzz773.pro/';

async function prepareDashboardNav(page) {
  await page.goto(new URL('index.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('token', 'playwright-dashboard-token');
    localStorage.setItem('user', JSON.stringify({ username: 'dashboard-user' }));
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav #authNavItem a[href="dashboard.html"]', { timeout: 5000 });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[TEST] Starting dashboard direct navigation verification...');
    await prepareDashboardNav(page);

    const popupMonitor = context.waitForEvent('page', { timeout: 1000 }).catch(() => null);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.click('nav #authNavItem a[href="dashboard.html"]')
    ]);

    const popup = await popupMonitor;
    if (popup) {
      throw new Error('Dashboard link should not open a popup window.');
    }

    const destinationUrl = page.url();
    if (!destinationUrl.includes('dashboard.html')) {
      throw new Error('Dashboard navigation did not reach dashboard.html.');
    }

    console.log('[TEST] Dashboard direct navigation verified.');
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
