const { chromium } = require('playwright');

const BASE_URL = process.env.BOTZZZ_TEST_ORIGIN || 'https://www.botzzz773.pro/';

async function openLandingPopup(page, context) {
  const launcherId = await page.evaluate(() => {
    const button = document.createElement('button');
    const id = `index-popup-launcher-${Date.now()}`;
    button.id = id;
    button.type = 'button';
    button.style.position = 'absolute';
    button.style.left = '-9999px';
    button.textContent = 'Open Home Popup';
    button.addEventListener('click', () => {
      window.open('index.html?popup=1', 'botzzz-home-popup', 'width=1200,height=820');
    });
    document.body.appendChild(button);
    return id;
  });

  const popupPromise = context.waitForEvent('page');
  await page.click(`#${launcherId}`);
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  await page.evaluate((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.remove();
    }
  }, launcherId);

  return popup;
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('[TEST] Starting home popup verification...');
    await page.goto(new URL('index.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });

    const popup = await openLandingPopup(page, context);

    const popupUrl = popup.url();
    if (!popupUrl.includes('index.html') || !popupUrl.includes('popup=1')) {
      throw new Error('Home popup URL missing popup parameter.');
    }

    const popupMode = await popup.evaluate(() => document.body.classList.contains('popup-mode'));
    if (!popupMode) {
      throw new Error('Home popup did not enable popup-mode.');
    }

    await popup.waitForSelector('[data-popup-surface][role="dialog"]', { timeout: 3000 });
    const closeButton = await popup.waitForSelector('[data-popup-close]', { timeout: 3000 });
    const closePromise = popup.waitForEvent('close');
    await closeButton.click();
    await closePromise;

    console.log('[TEST] Home popup regression completed successfully.');
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
