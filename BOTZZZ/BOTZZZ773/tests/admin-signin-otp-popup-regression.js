const { chromium } = require('playwright');

const BASE_URL = process.env.BOTZZZ_TEST_ORIGIN || 'https://www.botzzz773.pro/';

async function openAdminSigninOtpPopup(page, context) {
  const launcherId = await page.evaluate(() => {
    const button = document.createElement('button');
    const id = `admin-signin-otp-popup-launcher-${Date.now()}`;
    button.id = id;
    button.type = 'button';
    button.style.position = 'absolute';
    button.style.left = '-9999px';
    button.textContent = 'Open Admin Sign-in OTP Popup';
    button.addEventListener('click', () => {
      window.open('/admin/signin-otp.html?popup=1', 'botzzz-admin-signin-otp', 'width=640,height=840,resizable=yes,scrollbars=yes');
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

  try {
    const page = await context.newPage();

    console.log('[TEST] Starting admin sign-in OTP popup verification...');
    await page.goto(new URL('/admin/signin-otp.html', BASE_URL).toString(), { waitUntil: 'domcontentloaded' });

    const popup = await openAdminSigninOtpPopup(page, context);
    const popupUrl = popup.url();

    if (!popupUrl.includes('/admin/signin-otp.html') || !popupUrl.includes('popup=1')) {
      throw new Error('Admin sign-in OTP popup URL missing popup parameter.');
    }

    const popupMode = await popup.evaluate(() => document.body.classList.contains('popup-mode'));
    if (!popupMode) {
      throw new Error('Admin sign-in OTP popup did not enable popup-mode.');
    }

    await popup.waitForSelector('[data-popup-surface][role="dialog"]', { timeout: 5000 });
    await popup.waitForSelector('.auth-card', { timeout: 5000 });
    const closeButton = await popup.waitForSelector('[data-popup-close]', { timeout: 5000 });

    const closePromise = popup.waitForEvent('close');
    await closeButton.click();
    await closePromise;

    console.log('[TEST] Admin sign-in OTP popup regression completed successfully.');
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
