const { chromium } = require('playwright');

const BASE_URL = process.env.BOTZZZ_TEST_ORIGIN || 'https://www.botzzz773.pro/';

async function seedAuthState(page) {
  await page.evaluate(() => {
    localStorage.setItem('token', 'playwright-payment-token');
    localStorage.setItem('user', JSON.stringify({ username: 'payment-user' }));
    sessionStorage.clear();
  });
}

async function installMessageRecorder(page) {
  await page.evaluate(() => {
    window.__receivedMessages = [];
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      window.__receivedMessages.push(event.data);
    });
  });
}

async function openStatusPopup(page, context, relativePath) {
  const buttonId = await page.evaluate(({ path }) => {
    const button = document.createElement('button');
    const id = `popup-launcher-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    button.id = id;
    button.type = 'button';
    button.style.position = 'absolute';
    button.style.left = '-9999px';
    button.textContent = 'Open Payment Popup';
    button.addEventListener('click', () => {
      window.open(path, `botzzz-${path}`, 'width=900,height=720');
    });
    document.body.appendChild(button);
    return id;
  }, { path: relativePath });

  const popupPromise = context.waitForEvent('page');
  await page.click(`#${buttonId}`);
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  await page.evaluate((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.remove();
    }
  }, buttonId);

  return popup;
}

async function waitForMessage(page, type) {
  await page.waitForFunction((expectedType) => {
    return Array.isArray(window.__receivedMessages) &&
      window.__receivedMessages.some((msg) => msg?.type === expectedType);
  }, type, { timeout: 5000 });
}

async function verifyPaymentPopup(page, context, path, expectedMessage) {
  const popup = await openStatusPopup(page, context, path);

  const popupMode = await popup.evaluate(() => document.body.classList.contains('popup-mode'));
  if (!popupMode) {
    throw new Error(`Payment status popup for ${path} did not enable popup-mode.`);
  }

  await popup.waitForSelector('[data-close-window]', { timeout: 3000 });
  const closePromise = popup.waitForEvent('close');
  await popup.click('[data-close-window]');
  await closePromise;

  await waitForMessage(page, expectedMessage);
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(new URL('index.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });
    await seedAuthState(page);
    await installMessageRecorder(page);

    console.log('[TEST] Verifying payment success popup...');
    await verifyPaymentPopup(page, context, 'payment-success.html?popup=1', 'PAYMENT_SUCCESS');

    console.log('[TEST] Verifying payment failure popup...');
    await verifyPaymentPopup(page, context, 'payment-failed.html?popup=1', 'PAYMENT_FAILED');

    console.log('[TEST] Payment status popup regression completed successfully.');
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
